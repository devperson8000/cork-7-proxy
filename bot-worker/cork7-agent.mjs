import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const GAME_URL = "https://cork7.com/";
const PARKS = new Set(["APEX", "THE YARD", "SHIRAKUMO", "FOREST LINE", "BIG AIR", "BELLEVUE", "ASPEN PIPE"]);
const KEY_ALIASES = new Map([
  ["SPACE", "Space"], [" ", "Space"], ["LEFT", "ArrowLeft"], ["RIGHT", "ArrowRight"],
  ["ARROWLEFT", "ArrowLeft"], ["ARROWRIGHT", "ArrowRight"], ["ARROWUP", "ArrowUp"], ["ARROWDOWN", "ArrowDown"],
  ["UP", "ArrowUp"], ["DOWN", "ArrowDown"], ["SHIFT", "Shift"],
  ["A", "a"], ["D", "d"], ["W", "w"], ["S", "s"], ["Q", "q"], ["E", "e"],
  ["B", "b"], ["F", "f"], ["R", "r"]
]);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const cleanText = value => String(value || "").replace(/\s+/g, " ").trim().slice(0, 4500);

function detectScore(text) {
  const patterns = [
    /(?:TOTAL\s+SCORE|FINAL\s+SCORE|RUN\s+SCORE|SCORE)\s*[:\n-]?\s*([\d,]{2,})/i,
    /([\d,]{3,})\s*(?:PTS|POINTS)\b/i
  ];
  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    if (match) {
      const score = Number(match[1].replace(/,/g, ""));
      if (Number.isSafeInteger(score) && score >= 0) return score;
    }
  }
  return null;
}

function detectPhase(text, canvasCount) {
  const value = String(text || "").toLowerCase();
  if (/watch replay|save replay|run complete|run finished|ride again|total score/.test(value)) return "results";
  if (/choose a park|pick a park|ride solo|select park/.test(value)) return "park-select";
  const homeMenu = /solo\\s+picked/.test(value) && /\\bride\\b/.test(value);
  if (canvasCount > 0 && !homeMenu) return "game";
  if (homeMenu || /multiplayer|basecamp|locker|sign in|checking account/.test(value)) return "lobby";
  return canvasCount > 0 ? "game" : "loading";
}

export class Cork7Agent {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.startedAt = null;
    this.lastAction = "Not connected";
    this.lastError = null;
    this.starting = false;
    this.park = "APEX";
    this.actionCount = 0;
    this.training = false;
    this.trainingTask = null;
    this.coachProfile = null;
    this.stateFile = path.join(process.env.DATA_DIR || "/data", "cork7-training.json");
    this.trainer = { generation: 1, runsFinished: 0, bestScore: null, bestPolicy: null, history: [] };
  }

  async restoreTrainer() {
    try {
      const value = JSON.parse(await fs.readFile(this.stateFile, "utf8"));
      if (value && value.version === 1) {
        this.trainer = {
          generation: Number(value.generation) || 1,
          runsFinished: Number(value.runsFinished) || 0,
          bestScore: Number.isFinite(value.bestScore) ? value.bestScore : null,
          bestPolicy: value.bestPolicy || null,
          history: Array.isArray(value.history) ? value.history.slice(-80) : []
        };
        this.coachProfile = value.coachProfile || null;
      }
    } catch (error) {
      if (error.code !== "ENOENT") this.lastError = "Could not restore Cork7 trainer state: " + error.message;
    }
  }

  async saveTrainer() {
    await fs.mkdir(path.dirname(this.stateFile), { recursive: true });
    const value = { version: 1, ...this.trainer, coachProfile: this.coachProfile, savedAt: new Date().toISOString() };
    const tmp = this.stateFile + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(value));
    await fs.rename(tmp, this.stateFile);
  }

  trainerStatus() {
    return {
      training: this.training,
      generation: this.trainer.generation,
      runsFinished: this.trainer.runsFinished,
      bestScore: this.trainer.bestScore,
      bestPolicy: this.trainer.bestPolicy,
      history: this.trainer.history.slice(-12),
      coachProfile: this.coachProfile ? {
        park: this.coachProfile.park,
        targetCleanLandingRate: this.coachProfile.targetCleanLandingRate,
        targetVariety: this.coachProfile.targetVariety,
        updatedAt: this.coachProfile.updatedAt
      } : null
    };
  }

  setCoachProfile(profile) {
    this.coachProfile = profile && typeof profile === "object" ? profile : null;
    return this.trainerStatus();
  }

  randomPolicy() {
    const start = [14500, 33000, 51500, 70500];
    const grabKeys = ["q", "e", "Shift", null];
    const events = [];
    start.forEach((base, index) => {
      const lipTime = Math.max(5500, base - 1250 + Math.round((Math.random() - 0.5) * 1800));
      const spin = Math.random() < 0.5 ? "a" : "d";
      const flip = Math.random() < 0.5 ? "w" : "s";
      const grab = grabKeys[Math.floor(Math.random() * grabKeys.length)];
      const rodeo = Math.random() < 0.28;
      const keys = [spin, flip, grab, ...(rodeo ? ["ArrowUp"] : [])].filter(Boolean);
      events.push({ atMs: lipTime, keys: ["Space"], durationMs: 220 + Math.round(Math.random() * 360), id: index * 2 + 1 });
      events.push({
        atMs: lipTime + 350,
        keys: [...new Set(keys)].slice(0, 4),
        durationMs: 220 + Math.round(Math.random() * 520),
        id: index * 2 + 2
      });
    });
    return { events: events.sort((a, b) => a.atMs - b.atMs), createdAt: new Date().toISOString() };
  }

  nextPolicy() {
    if (!this.trainer.bestPolicy || Math.random() < 0.22) return this.randomPolicy();
    const parent = this.trainer.bestPolicy;
    const events = parent.events.map((event, index) => {
      const keys = event.keys.slice();
      if (Math.random() < 0.3) {
        const spinAt = keys.findIndex(key => key === "a" || key === "d");
        if (spinAt >= 0) keys[spinAt] = keys[spinAt] === "a" ? "d" : "a";
      }
      if (Math.random() < 0.28) {
        const flipAt = keys.findIndex(key => key === "w" || key === "s");
        if (flipAt >= 0) keys[flipAt] = keys[flipAt] === "w" ? "s" : "w";
        else keys.push(Math.random() < 0.5 ? "w" : "s");
      }
      if (Math.random() < 0.22) {
        const grabAt = keys.findIndex(key => key === "q" || key === "e" || key === "Shift");
        if (grabAt >= 0) keys[grabAt] = ["q", "e", "Shift"][Math.floor(Math.random() * 3)];
        else if (keys.length < 3) keys.push(["q", "e", "Shift"][Math.floor(Math.random() * 3)]);
      }
      const landingFocus = this.coachProfile && Number(this.coachProfile.observedCleanLandingRate) < 0.72;
      const duration = Math.max(160, Math.min(900,
        event.durationMs + Math.round((Math.random() - 0.5) * (landingFocus ? 260 : 420))));
      const atMs = Math.max(6000, event.atMs + Math.round((Math.random() - 0.5) * 5000));
      return { id: index + 1, atMs, keys: [...new Set(keys)].slice(0, 3), durationMs: duration };
    });
    return { events: events.sort((a, b) => a.atMs - b.atMs), createdAt: new Date().toISOString() };
  }

  async startTraining() {
    if (!this.page || this.page.isClosed()) throw new Error("Launch a Cork7 Solo session before starting the trainer.");
    const current = await this.status();
    if (current.phase !== "game") throw new Error("The Cork7 Solo run is not ready yet. Launch a park and reach the actual run before starting the trainer.");
    if (this.training) return this.trainerStatus();
    this.training = true;
    this.lastError = null;
    this.trainingTask = this.runTrainingLoop().catch(error => {
      this.lastError = "Trainer stopped: " + String(error?.message || error).slice(0, 240);
      this.training = false;
    });
    return this.trainerStatus();
  }

  async pauseTraining() {
    this.training = false;
    return this.trainerStatus();
  }

  async waitUntil(targetTime, maxStep = 300) {
    while (this.training && Date.now() < targetTime) {
      const remaining = targetTime - Date.now();
      await sleep(Math.min(maxStep, Math.max(30, remaining)));
    }
  }

  async runOnePolicy(policy) {
    if (!this.page || this.page.isClosed()) throw new Error("Cork7 browser session closed.");
    const initial = await this.status();
    if (initial.phase === "results") {
      await this.page.keyboard.down("r");
      await sleep(2200);
      await this.page.keyboard.up("r").catch(() => {});
      await this.page.waitForTimeout(1800);
      await this.page.keyboard.press("f").catch(() => {});
      await this.page.waitForTimeout(1000);
    }

    this.lastAction = "Running a Cork7 Solo training attempt";
    const runStarted = Date.now();
    for (const event of policy.events) {
      if (!this.training) return { cancelled: true };
      await this.waitUntil(runStarted + event.atMs);
      if (!this.training) return { cancelled: true };
      const before = await this.status();
      if (before.phase === "results") break;
      const pressed = event.keys;
      for (const key of pressed) await this.page.keyboard.down(key);
      try { await sleep(event.durationMs); }
      finally { for (const key of pressed) await this.page.keyboard.up(key).catch(() => {}); }
      this.actionCount++;
      this.lastAction = "AI policy " + event.id + ": " + pressed.join(" + ") + " for " + event.durationMs + " ms";
    }

    const deadline = Date.now() + 145000;
    let result = await this.status();
    while (this.training && Date.now() < deadline) {
      if (result.phase === "results") break;
      await sleep(1200);
      result = await this.status();
    }
    if (!this.training) return { cancelled: true };
    if (result.phase !== "results") {
      throw new Error("The bot did not detect Cork7's results screen within 145 seconds. Last page text: " + cleanText(result.pageText).slice(0, 500));
    }
    if (result.score == null) {
      throw new Error("Cork7 reached the results screen, but its score was not readable from page text. The captured screen is available for HUD integration.");
    }
    return { score: result.score, policy, phase: result.phase, capturedAt: result.capturedAt };
  }

  async runTrainingLoop() {
    while (this.training) {
      const policy = this.nextPolicy();
      try {
        const result = await this.runOnePolicy(policy);
        if (result.cancelled) break;
        this.trainer.runsFinished++;
        if (this.trainer.bestScore == null || result.score > this.trainer.bestScore) {
          this.trainer.bestScore = result.score;
          this.trainer.bestPolicy = policy;
        }
        this.trainer.history.push({
          run: this.trainer.runsFinished,
          generation: this.trainer.generation,
          score: result.score,
          best: this.trainer.bestScore,
          capturedAt: result.capturedAt
        });
        if (this.trainer.history.length > 80) this.trainer.history.shift();
        this.trainer.generation = 1 + Math.floor(this.trainer.runsFinished / 6);
        this.lastAction = "Training run " + this.trainer.runsFinished + " scored " + result.score.toLocaleString();
        await this.saveTrainer();
        await sleep(1200);
      } catch (error) {
        this.lastError = String(error?.message || error).slice(0, 500);
        this.training = false;
      }
    }
    return this.trainerStatus();
  }

  async ensureBrowser() {
    if (this.browser && this.page && !this.page.isClosed()) return;
    this.browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--enable-webgl",
        "--ignore-gpu-blocklist",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader"
      ]
    });
    this.context = await this.browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      locale: "en-US",
      colorScheme: "dark"
    });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(3500);
    this.page.on("pageerror", error => { this.lastError = error.message.slice(0, 240); });
    this.page.on("crash", () => { this.lastError = "Cork7 browser tab crashed."; });
    this.startedAt = Date.now();
    this.lastError = null;
  }

  async clickVisibleText(label) {
    if (!this.page) return false;
    const escaped = String(label).replace(/[.*+?^()|[\]\\]/g, "\\$&");
    const pattern = new RegExp("^\\s*" + escaped + "\\s*$", "i");
    try {
      const button = this.page.getByRole("button", { name: pattern }).first();
      if (await button.isVisible()) {
        await button.click({ timeout: 2200 });
        return true;
      }
    } catch {}
    try {
      const locator = this.page.getByText(pattern).first();
      if (await locator.isVisible()) {
        await locator.click({ timeout: 2200 });
        return true;
      }
    } catch {}
    return false;
  }

  async start({ park = "APEX" } = {}) {
    const chosenPark = String(park || "APEX").trim().toUpperCase();
    if (!PARKS.has(chosenPark)) throw new Error("Unsupported Cork7 park. Choose APEX, THE YARD, SHIRAKUMO, FOREST LINE, BIG AIR or BELLEVUE.");
    if (this.page && !this.page.isClosed()) {
      return this.status({ screenshot: true });
    }

    this.park = chosenPark;
    this.lastAction = "Opening a fresh, unsigned Cork7 Solo session";
    this.lastError = null;
    await this.ensureBrowser();

    try {
      await this.page.goto(GAME_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
      await this.page.waitForTimeout(9000);

      let text = await this.readText();
      if (/sign in|log in|create account/i.test(text) && !/solo/i.test(text)) {
        this.lastError = "The page is asking for an account before Solo can start. No credentials were entered.";
        return this.status({ screenshot: true });
      }

      // Solo is the default mode on the public landing screen. If another mode
      // is selected, click Solo; never open account or multiplayer flows.
      if (!/solo\s+picked/i.test(text)) await this.clickVisibleText("Solo");
      await this.page.keyboard.press("Enter").catch(() => {});
      await this.page.waitForTimeout(3500);

      text = await this.readText();
      if (text.toUpperCase().includes(chosenPark)) {
        const parkClicked = await this.clickVisibleText(chosenPark);
        if (!parkClicked) await this.page.keyboard.press("Enter").catch(() => {});
        await this.page.waitForTimeout(900);
      }

      // The normal solo flow shows Ride after the park is selected.
      text = await this.readText();
      const rideClicked = await this.clickVisibleText("Ride Solo") || await this.clickVisibleText("Ride");
      if (!rideClicked && /ride|start|\\benter\\b/i.test(text)) {
        await this.page.keyboard.press("Enter").catch(() => {});
      }

      await this.page.waitForTimeout(12000);
      const afterNavigation = await this.status();
      if (afterNavigation.phase === "game") {
        await this.page.keyboard.press("f").catch(() => {});
        await this.page.waitForTimeout(1500);
        this.lastAction = "Solo game loaded; F sent to skip the gondola";
      } else {
        this.lastAction = "Cork7 opened; the Solo park view is not confirmed yet";
      }
      return await this.status({ screenshot: true });
    } catch (error) {
      this.lastError = String(error?.message || error).slice(0, 400);
      return await this.status({ screenshot: true });
    }
  }

  async readText() {
    if (!this.page || this.page.isClosed()) return "";
    try {
      return await this.page.locator("body").innerText({ timeout: 2500 });
    } catch {
      return "";
    }
  }

  async status({ screenshot = false } = {}) {
    const text = await this.readText();
    const canvasCount = this.page && !this.page.isClosed()
      ? await this.page.locator("canvas").count().catch(() => 0) : 0;
    const phase = this.starting ? "starting" : detectPhase(text, canvasCount);
    const data = {
      connected: !!(this.page && !this.page.isClosed()),
      starting: this.starting,
      site: "cork7.com",
      mode: "Solo / unsigned browser session",
      park: this.park,
      phase,
      score: detectScore(text),
      canvasCount,
      actionCount: this.actionCount,
      lastAction: this.lastAction,
      lastError: this.lastError,
      pageTitle: this.page && !this.page.isClosed() ? await this.page.title().catch(() => "") : "",
      pageText: cleanText(text),
      trainer: this.trainerStatus(),
      elapsedSeconds: this.startedAt ? Math.round((Date.now() - this.startedAt) / 1000) : 0,
      capturedAt: new Date().toISOString()
    };
    if (screenshot && this.page && !this.page.isClosed()) {
      try {
        const buffer = await this.page.screenshot({ type: "jpeg", quality: 55, timeout: 8000 });
        data.screenshot = buffer.toString("base64");
      } catch (error) {
        data.screenshotError = String(error?.message || error).slice(0, 180);
      }
    }
    return data;
  }

  async act({ keys = [], durationMs = 250 } = {}) {
    if (!this.page || this.page.isClosed()) throw new Error("Start a Cork7 Solo session first.");
    if (!Array.isArray(keys) || keys.length < 1 || keys.length > 4) throw new Error("Send between 1 and 4 keys.");
    const duration = Math.max(50, Math.min(1400, Number(durationMs) || 250));
    const normalized = [...new Set(keys.map(value => KEY_ALIASES.get(String(value).toUpperCase()) || null).filter(Boolean))];
    if (!normalized.length) throw new Error("No permitted game controls were supplied.");
    for (const key of normalized) await this.page.keyboard.down(key);
    try {
      await sleep(duration);
    } finally {
      for (const key of normalized) await this.page.keyboard.up(key).catch(() => {});
    }
    this.actionCount += 1;
    this.lastAction = "Pressed " + normalized.join(" + ") + " for " + duration + " ms";
    return this.status();
  }

  async restart() {
    if (!this.page || this.page.isClosed()) throw new Error("Start a Cork7 Solo session first.");
    // Cork7 documents holding R to restart a run from the top.
    await this.page.keyboard.down("r");
    await sleep(2200);
    await this.page.keyboard.up("r").catch(() => {});
    this.actionCount += 1;
    this.lastAction = "Held R to request a local Solo restart";
    await this.page.waitForTimeout(1800);
    return this.status({ screenshot: true });
  }

  async close() {
    this.training = false;
    this.starting = false;
    try { if (this.browser) await this.browser.close(); } catch {}
    this.browser = null;
    this.context = null;
    this.training = false;
    this.page = null;
    this.startedAt = null;
    this.lastAction = "Cork7 browser session closed";
    return { connected: false, site: "cork7.com", lastAction: this.lastAction, trainer: this.trainerStatus() };
  }
}
