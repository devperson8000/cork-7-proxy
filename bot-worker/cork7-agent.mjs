import { chromium } from "playwright";

const GAME_URL = "https://cork7.com/";
const PARKS = new Set(["APEX", "THE YARD", "SHIRAKUMO", "FOREST LINE", "BIG AIR", "BELLEVUE", "ASPEN PIPE"]);
const KEY_ALIASES = new Map([
  ["SPACE", "Space"], [" ", "Space"], ["LEFT", "ArrowLeft"], ["RIGHT", "ArrowRight"],
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
  if (canvasCount > 0) return "game";
  if (/solo|multiplayer|basecamp|locker/.test(value)) return "lobby";
  return "loading";
}

export class Cork7Agent {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.startedAt = null;
    this.lastAction = "Not connected";
    this.lastError = null;
    this.park = "APEX";
    this.actionCount = 0;
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
        await this.clickVisibleText(chosenPark);
        await this.page.waitForTimeout(900);
      }

      // The park picker and Ride button are in the normal public solo flow.
      if (/ride|start/i.test(text) || text.toUpperCase().includes(chosenPark)) {
        const rideClicked = await this.clickVisibleText("Ride") || await this.clickVisibleText("Ride Solo");
        if (!rideClicked) await this.page.keyboard.press("Enter").catch(() => {});
      }

      await this.page.waitForTimeout(12000);
      const canvasCount = await this.page.locator("canvas").count().catch(() => 0);
      if (canvasCount > 0) {
        await this.page.keyboard.press("f").catch(() => {});
        await this.page.waitForTimeout(1500);
        this.lastAction = "Solo game loaded; F sent to skip the gondola";
      } else {
        this.lastAction = "Cork7 opened; waiting for the park/game view";
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
    const phase = detectPhase(text, canvasCount);
    const data = {
      connected: !!(this.page && !this.page.isClosed()),
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
    try { if (this.browser) await this.browser.close(); } catch {}
    this.browser = null;
    this.context = null;
    this.page = null;
    this.startedAt = null;
    this.lastAction = "Cork7 browser session closed";
    return { connected: false, site: "cork7.com", lastAction: this.lastAction };
  }
}
