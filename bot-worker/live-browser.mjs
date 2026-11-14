import { chromium } from "playwright-core";

const GAME_URL = process.env.LIVE_GAME_URL || "https://cork7game.vercel.app/c7";
const VIEWPORT = { width: 1440, height: 900 };
const ALLOWED_KEYS = new Set([
  "A", "D", "W", "S", "Space", "Shift", "Q", "E",
  "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "F", "R", "Escape", "P"
]);

let browser = null;
let context = null;
let page = null;
let gameFrame = null;
let screenshotTimer = null;
let pilotTask = null;
let pilotRequested = false;
let screenshotBusy = false;
const heldKeys = new Set();

const state = {
  available: true,
  browser: "offline",
  game: "not-loaded",
  playing: false,
  phase: "offline",
  pageUrl: null,
  frameUrl: null,
  canvasCount: 0,
  frameCount: 0,
  lastInput: "—",
  lastError: null,
  lastScreenshotAt: null,
  startedAt: null,
  cycles: 0,
  notes: "Launch the remote browser, then select Solo and enter a park."
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function publicFrameUrl(value) {
  try {
    const u = new URL(value);
    return u.origin + u.pathname.slice(0, 180);
  } catch {
    return String(value || "").slice(0, 180);
  }
}

async function locateGameFrame() {
  if (!page) return null;
  const frames = page.frames().filter(frame => frame !== page.mainFrame());
  let fallback = null;

  for (const frame of frames.slice().reverse()) {
    try {
      if (frame.isDetached()) continue;
      const url = frame.url();
      const canvasCount = await frame.locator("canvas").count().catch(() => 0);
      if (canvasCount > 0 || /cork7|scramjet/i.test(url)) return frame;
      if (url && url !== "about:blank") fallback ||= frame;
    } catch {
      // A frame can be replaced while Scramjet navigates it.
    }
  }
  return fallback || frames.at(-1) || null;
}

async function inspectPage() {
  if (!page || page.isClosed()) {
    state.browser = "offline";
    state.game = "not-loaded";
    state.frameUrl = null;
    state.canvasCount = 0;
    state.frameCount = 0;
    return;
  }

  gameFrame = await locateGameFrame();
  const frames = page.frames();
  state.pageUrl = publicFrameUrl(page.url());
  state.frameCount = frames.length;

  if (!gameFrame) {
    state.game = "waiting-for-game-frame";
    state.frameUrl = null;
    state.canvasCount = 0;
    return;
  }

  state.frameUrl = publicFrameUrl(gameFrame.url());
  state.canvasCount = await gameFrame.locator("canvas").count().catch(() => 0);
  state.game = state.canvasCount > 0 ? "game-canvas-found" : "player-frame-found";
  state.phase = state.playing ? "autopilot-running" : "ready";
}

async function captureScreenshot() {
  if (!page || page.isClosed() || screenshotBusy) return;
  screenshotBusy = true;
  try {
    const bytes = await page.screenshot({
      type: "jpeg",
      quality: 58,
      fullPage: false,
      animations: "disabled",
      timeout: 7000
    });
    state.screenshot = bytes.toString("base64");
    state.lastScreenshotAt = new Date().toISOString();
  } catch (error) {
    state.lastError = "Screenshot capture: " + String(error?.message || error).slice(0, 180);
  } finally {
    screenshotBusy = false;
  }
}

async function launchBrowser() {
  try {
    state.browser = "starting";
    state.phase = "starting";
    state.lastError = null;
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--enable-webgl",
        "--ignore-gpu-blocklist",
        "--use-gl=angle",
        "--use-angle=swiftshader-webgl"
      ]
    });

    context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      locale: "en-AU",
      colorScheme: "dark"
    });
    page = await context.newPage();
    page.setDefaultTimeout(5000);
    page.on("pageerror", error => {
      state.lastError = "Game page error: " + String(error?.message || error).slice(0, 180);
    });
    page.on("close", () => {
      state.browser = "page-closed";
      state.playing = false;
      pilotRequested = false;
    });

    state.startedAt = new Date().toISOString();
    await page.goto(GAME_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    state.browser = "online";
    state.phase = "loading-game";
    await sleep(8000);
    await inspectPage();
    await captureScreenshot();

    if (screenshotTimer) clearInterval(screenshotTimer);
    screenshotTimer = setInterval(() => {
      void inspectPage().then(captureScreenshot).catch(error => {
        state.lastError = String(error?.message || error).slice(0, 180);
      });
    }, 1500);

    state.notes = "Browser is open. Use the live view to select Solo and enter a park before starting the bot.";
  } catch (error) {
    state.browser = "error";
    state.phase = "error";
    state.lastError = String(error?.message || error).slice(0, 240);
    state.notes = "The browser could not open the player. Check the service memory and browser logs.";
    await closeBrowser();
  }
}

async function start() {
  if (browser && page && !page.isClosed()) {
    await inspectPage();
    return status();
  }
  if (state.browser === "starting") return status();
  void launchBrowser();
  return status();
}

async function focusGame() {
  if (!page || page.isClosed()) throw new Error("Launch the Cork7 browser first.");
  gameFrame = await locateGameFrame();
  if (!gameFrame) throw new Error("The Cork7 game frame has not loaded yet.");

  const canvas = gameFrame.locator("canvas").first();
  const hasCanvas = await canvas.count().catch(() => 0);
  if (hasCanvas) {
    await canvas.click({ position: { x: 20, y: 20 }, force: true, timeout: 4000 }).catch(async () => {
      await gameFrame.locator("body").click({ position: { x: 700, y: 420 }, force: true, timeout: 4000 });
    });
  } else {
    await gameFrame.locator("body").click({ position: { x: 700, y: 420 }, force: true, timeout: 4000 });
  }
}

async function releaseAll() {
  if (!page || page.isClosed()) {
    heldKeys.clear();
    return;
  }
  for (const key of [...heldKeys]) {
    await page.keyboard.up(key).catch(() => {});
    heldKeys.delete(key);
  }
}

async function keyDown(key) {
  if (!ALLOWED_KEYS.has(key)) throw new Error("That key is not enabled.");
  if (!page || page.isClosed()) throw new Error("The Cork7 browser is not open.");
  if (!heldKeys.has(key)) {
    await page.keyboard.down(key);
    heldKeys.add(key);
  }
  state.lastInput = "Hold " + key;
}

async function keyUp(key) {
  if (!ALLOWED_KEYS.has(key)) throw new Error("That key is not enabled.");
  if (!page || page.isClosed()) throw new Error("The Cork7 browser is not open.");
  if (heldKeys.has(key)) {
    await page.keyboard.up(key).catch(() => {});
    heldKeys.delete(key);
  }
  state.lastInput = "Release " + key;
}

async function tap(key, duration = 120) {
  await keyDown(key);
  await sleep(duration);
  await keyUp(key);
}

async function holdCombo(keys, duration) {
  for (const key of keys) await keyDown(key);
  await sleep(duration);
  for (const key of keys.slice().reverse()) await keyUp(key);
}

async function input(data) {
  if (!page || page.isClosed()) throw new Error("Launch the Cork7 browser first.");
  if (data?.kind === "click") {
    const x = Number(data.x), y = Number(data.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > VIEWPORT.width || y > VIEWPORT.height) {
      throw new Error("Click coordinates are outside the browser view.");
    }
    await page.mouse.click(x, y);
    state.lastInput = "Click " + Math.round(x) + ", " + Math.round(y);
    return status();
  }
  if (data?.kind === "tap") {
    const key = String(data.key || "");
    await focusGame();
    await tap(key, Math.min(500, Math.max(50, Number(data.duration) || 120)));
    return status();
  }
  if (data?.kind === "hold") {
    const key = String(data.key || "");
    await focusGame();
    await keyDown(key);
    return status();
  }
  if (data?.kind === "release") {
    const key = String(data.key || "");
    await keyUp(key);
    return status();
  }
  throw new Error("Unsupported live input.");
}

async function pilotLoop() {
  let direction = "D";
  let flip = "S";
  try {
    await focusGame();
    // F skips the lift ride if the game is currently showing the gondola.
    await tap("F", 120);
    await sleep(700);
    while (pilotRequested && page && !page.isClosed()) {
      await holdCombo(["W"], 800);
      await holdCombo(["Space"], 220);
      await holdCombo([direction, flip, "Shift"], 420);
      await releaseAll();
      await sleep(850);
      await holdCombo(["W"], 600);
      await holdCombo(["Space"], 200);
      await holdCombo([direction === "D" ? "A" : "D", flip === "S" ? "W" : "S", "E"], 420);
      await releaseAll();
      await sleep(950);
      direction = direction === "D" ? "A" : "D";
      flip = flip === "S" ? "W" : "S";
      state.cycles++;
      state.lastInput = "Autopilot cycle " + state.cycles;
    }
  } catch (error) {
    state.lastError = "Autopilot stopped: " + String(error?.message || error).slice(0, 180);
    pilotRequested = false;
  } finally {
    await releaseAll();
    state.playing = false;
    state.phase = browser && page && !page.isClosed() ? "ready" : "offline";
  }
}

async function play() {
  if (!page || page.isClosed()) throw new Error("Launch the Cork7 browser first.");
  if (state.browser !== "online") throw new Error("Wait for the Cork7 page to finish loading.");
  if (state.playing) return status();
  await focusGame();
  pilotRequested = true;
  state.playing = true;
  state.phase = "autopilot-running";
  state.lastError = null;
  state.notes = "Experimental live autopilot is sending keyboard controls. It uses timed actions, not learned game-state feedback yet.";
  pilotTask = pilotLoop().finally(() => { pilotTask = null; });
  return status();
}

async function pause() {
  pilotRequested = false;
  state.playing = false;
  await releaseAll();
  state.phase = browser && page && !page.isClosed() ? "ready" : "offline";
  state.notes = "Autopilot paused. The live browser remains open.";
  return status();
}

async function closeBrowser() {
  pilotRequested = false;
  state.playing = false;
  await releaseAll();
  if (screenshotTimer) clearInterval(screenshotTimer);
  screenshotTimer = null;
  const old = browser;
  browser = null;
  context = null;
  page = null;
  gameFrame = null;
  if (old) await old.close().catch(() => {});
  state.browser = "offline";
  state.game = "not-loaded";
  state.phase = "offline";
  state.pageUrl = null;
  state.frameUrl = null;
  state.canvasCount = 0;
  state.frameCount = 0;
  state.screenshot = null;
  state.lastScreenshotAt = null;
  state.startedAt = null;
  state.notes = "Browser stopped.";
  return status();
}

async function stop() {
  await closeBrowser();
  return status();
}

function status() {
  const { screenshot, ...publicState } = state;
  return { ...publicState, screenshot: screenshot || null, viewport: VIEWPORT };
}

export { start, play, pause, stop, input, status };
