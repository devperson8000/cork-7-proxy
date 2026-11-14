import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Cork7Agent } from "./cork7-agent.mjs";

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || "/data";
const STATE_FILE = path.join(DATA_DIR, "apex-state.json");
const TOKEN = process.env.BOT_CONTROL_TOKEN || "";
const cork7Agent = new Cork7Agent();
const POP_SIZE = 16, INPUTS = 10, HIDDEN = 12, OUTPUTS = 5;
const TRACK_END = 1120, EPISODE_STEPS = 700, STEPS_PER_TICK = 8;
const TICK_MS = 40;

if (TOKEN.length < 32) {
  console.error("BOT_CONTROL_TOKEN must be set to a random value of at least 32 characters.");
  process.exit(1);
}

const FEATURES = [
  { id: "j1", type: "jump", z: 145, lane: -0.42 },
  { id: "r1", type: "rail", z: 310, lane: 0.48, len: 62 },
  { id: "j2", type: "jump", z: 490, lane: 0.45 },
  { id: "r2", type: "rail", z: 665, lane: -0.48, len: 68 },
  { id: "j3", type: "jump", z: 850, lane: -0.08 },
  { id: "r3", type: "rail", z: 1010, lane: 0.34, len: 58 }
];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const gaussian = () => {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const randomArray = (n, scale) => Array.from({ length: n }, () => rand(-scale, scale));

function makeGenome() {
  return {
    w1: randomArray(INPUTS * HIDDEN, 0.48),
    b1: randomArray(HIDDEN, 0.22),
    w2: randomArray(HIDDEN * OUTPUTS, 0.42),
    b2: randomArray(OUTPUTS, 0.2),
    fitness: 0
  };
}
function cloneGenome(g) {
  return { w1: g.w1.slice(), b1: g.b1.slice(), w2: g.w2.slice(), b2: g.b2.slice(), fitness: g.fitness || 0 };
}
function forward(g, input) {
  const hidden = new Array(HIDDEN);
  for (let h = 0; h < HIDDEN; h++) {
    let sum = g.b1[h];
    for (let i = 0; i < INPUTS; i++) sum += g.w1[h * INPUTS + i] * input[i];
    hidden[h] = Math.tanh(sum);
  }
  const out = new Array(OUTPUTS);
  for (let o = 0; o < OUTPUTS; o++) {
    let sum = g.b2[o];
    for (let h = 0; h < HIDDEN; h++) sum += g.w2[o * HIDDEN + h] * hidden[h];
    out[o] = Math.tanh(sum);
  }
  return out;
}
function makeState() {
  return {
    z: 0, x: 0, vx: 0, speed: 38, height: 0, vy: 0,
    airborne: false, rotation: 0, grabTime: 0,
    rail: false, railId: null, railSamples: 0, railGood: 0,
    score: 0, landings: 0, rails: 0, missed: 0, crashes: 0,
    combo: 0, steps: 0, done: false, cleared: {}, triggered: {},
    tricks: [], trace: [], lastTrick: "Learning steering and feature timing"
  };
}
function nearestFeature(s) {
  for (const f of FEATURES) if (!s.cleared[f.id]) return f;
  return { id: "finish", type: "finish", z: TRACK_END, lane: 0 };
}
function observation(s) {
  const f = nearestFeature(s);
  return [
    clamp(s.x, -1, 1),
    clamp(s.vx / 2, -1, 1),
    clamp((s.speed - 35) / 18, -1, 1),
    clamp((f.z - s.z) / 180, -1, 1),
    clamp(f.lane, -1, 1),
    f.type === "jump" ? 1 : 0,
    f.type === "rail" ? 1 : 0,
    clamp(s.height / 28, 0, 1),
    clamp(s.vy / 24, -1, 1),
    clamp(s.combo / 4, 0, 1)
  ];
}
function registerTrick(s, label, points) {
  const count = trickBook[label] || 0;
  const novelty = count === 0 ? 48 : Math.max(5, 34 / (1 + count * 0.24));
  const gained = Math.round(points + novelty);
  s.score += gained;
  s.tricks.push(label);
  s.lastTrick = label + "  +" + gained;
  s.combo++;
  trickBook[label] = count + 1;
}
function finishLanding(s) {
  const turns = Math.floor(Math.abs(s.rotation) / 360);
  const remainder = Math.abs(s.rotation) % 360;
  const clean = Math.abs(s.x) < 1.02 && Math.abs(s.vx) < 1.5 && turns <= 3;
  if (clean && turns >= 1) {
    const grab = s.grabTime > 0.18;
    const label = (turns === 1 ? "360" : turns === 2 ? "720" : "1080") + (grab ? " grab" : "");
    const points = turns * 112 + (grab ? 88 : 0) + Math.round((1 - Math.abs(remainder - 180) / 180) * 22);
    registerTrick(s, label, Math.max(35, points));
    s.landings++;
    totalLandings++;
  } else {
    s.score += clean ? 8 : -12;
    s.combo = 0;
    s.lastTrick = clean ? "Clean landing" : "Sketchy landing";
    if (!clean) s.crashes++;
  }
  s.height = 0; s.vy = 0; s.airborne = false; s.rotation = 0; s.grabTime = 0;
}
function pushTrace(s) {
  if (s.steps % 3 !== 0) return;
  s.trace.push({
    z: s.z, x: s.x, vx: s.vx, speed: s.speed, height: s.height,
    rotation: s.rotation, airborne: s.airborne, rail: s.rail,
    score: s.score, combo: s.combo, lastTrick: s.lastTrick
  });
}
function advance(s, genome) {
  if (s.done) return;
  s.steps++;
  const a = forward(genome, observation(s));
  const steer = a[0], pop = a[1], spin = a[2], grab = a[3], balance = a[4];
  const dt = 0.05;

  s.vx = (s.vx + steer * 2.65 * dt) * 0.94;
  s.x = clamp(s.x + s.vx * dt, -1.35, 1.35);
  s.speed = clamp(s.speed + 0.2 * dt, 25, 52);
  s.z += s.speed * dt;
  s.score += s.speed * dt * 0.025;

  for (const f of FEATURES) {
    if (f.type === "jump" && !s.triggered[f.id] && s.z >= f.z - 5) {
      s.triggered[f.id] = true;
      const aligned = Math.abs(s.x - f.lane) < 0.48;
      const timing = clamp((pop + 1) / 2, 0, 1);
      s.vy = 13 + timing * 12 + (aligned ? 3 : -2);
      s.height = 0.2; s.airborne = true; s.rotation = 0; s.grabTime = 0;
      s.score += aligned ? 18 : -10;
      s.cleared[f.id] = true;
    }
    if (f.type === "rail") {
      if (!s.triggered[f.id] && s.z >= f.z) {
        s.triggered[f.id] = true;
        if (Math.abs(s.x - f.lane) < 0.42) {
          s.rail = true; s.railId = f.id; s.railSamples = 0; s.railGood = 0;
          s.combo++;
        } else {
          s.missed++; s.score -= 16; s.lastTrick = "Rail missed";
        }
      }
      if (s.rail && s.railId === f.id && s.z < f.z + f.len) {
        s.railSamples++;
        s.railGood += clamp(1 - Math.abs(s.x - f.lane), 0, 1) * (1 - Math.abs(balance) * 0.18);
        s.vx += (f.lane - s.x) * 0.18 * dt;
        s.x += (f.lane - s.x) * 0.09 * dt;
      }
      if (s.rail && s.railId === f.id && s.z >= f.z + f.len) {
        const quality = s.railSamples ? s.railGood / s.railSamples : 0;
        registerTrick(s, "Rail " + (quality > 0.78 ? "locked" : "slide"), 105 + quality * 125);
        s.rails++; s.rail = false; s.railId = null; s.cleared[f.id] = true;
      }
      if (!s.cleared[f.id] && s.z >= f.z + f.len) {
        s.cleared[f.id] = true;
        if (!s.triggered[f.id] || s.railId !== f.id) s.missed++;
      }
    }
  }

  if (s.airborne) {
    s.vy -= 27 * dt;
    s.height += s.vy * dt;
    s.rotation += spin * 410 * dt;
    if (grab > 0.12) s.grabTime += dt;
    if (s.height <= 0 && s.vy < 0) finishLanding(s);
  }
  if (Math.abs(s.x) > 1.22) {
    s.crashes++; s.score -= 65; s.done = true;
  }
  if (s.z >= TRACK_END || s.steps >= EPISODE_STEPS) s.done = true;
  s.score = clamp(s.score, -100, 5000);
  pushTrace(s);
}
function fitness(s) {
  const profile = coachProfile;
  const cleanRate = profile ? profile.observedCleanLandingRate : 0.75;
  const repeatRate = profile ? profile.observedRepeatRate : 0.25;
  const landingWeight = 58 + Math.round((1 - cleanRate) * 70);
  const crashPenalty = 115 + Math.round((1 - cleanRate) * 100);
  const varietyWeight = 8 + Math.round(repeatRate * 28);
  const uniqueTricks = new Set(s.tricks).size;
  return s.score + s.z * 0.115 + s.landings * landingWeight +
    s.rails * 78 - s.missed * 20 - s.crashes * crashPenalty +
    uniqueTricks * varietyWeight;
}
function tournament(sorted) {
  let best = sorted[Math.floor(Math.random() * Math.max(6, Math.ceil(sorted.length * 0.65)))];
  for (let i = 0; i < 3; i++) {
    const c = sorted[Math.floor(Math.random() * Math.max(6, Math.ceil(sorted.length * 0.65)))];
    if (c.fitness > best.fitness) best = c;
  }
  return best;
}
function crossover(a, b) {
  const child = cloneGenome(a);
  for (const key of ["w1", "b1", "w2", "b2"]) {
    for (let i = 0; i < child[key].length; i++) {
      if (Math.random() < 0.5) child[key][i] = b[key][i];
      else if (Math.random() < 0.17) child[key][i] = (a[key][i] + b[key][i]) * 0.5;
    }
  }
  child.fitness = 0;
  return child;
}
function mutate(g) {
  for (const key of ["w1", "b1", "w2", "b2"]) {
    for (let i = 0; i < g[key].length; i++) {
      if (Math.random() < 0.13) g[key][i] += gaussian() * mutationSigma;
      if (Math.random() < 0.012) g[key][i] = rand(-0.8, 0.8);
      g[key][i] = clamp(g[key][i], -3, 3);
    }
  }
  return g;
}

let genomes = Array.from({ length: POP_SIZE }, makeGenome);
let generation = 1, agentIndex = 0, runsFinished = 0, totalLandings = 0;
let bestFitness = -Infinity, bestReplay = null, history = [], trickBook = {}, coachProfile = null;
let mutationSigma = 0.15, stagnantGenerations = 0, training = false;
let currentState = makeState(), startedAt = null, lastSavedAt = 0, saving = false;

async function saveState() {
  if (saving) return;
  saving = true;
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const snapshot = {
      version: 1, training, generation, agentIndex, runsFinished, totalLandings,
      bestFitness, bestReplay, history, trickBook, mutationSigma, stagnantGenerations,
      coachProfile, genomes, currentState, savedAt: new Date().toISOString()
    };
    const tmp = STATE_FILE + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(snapshot));
    await fs.rename(tmp, STATE_FILE);
    lastSavedAt = Date.now();
  } catch (error) {
    console.error("State checkpoint failed:", error.message);
  } finally {
    saving = false;
  }
}
async function loadState() {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    const d = JSON.parse(raw);
    if (d.version !== 1 || !Array.isArray(d.genomes) || d.genomes.length !== POP_SIZE) return;
    generation = d.generation || 1;
    agentIndex = clamp(d.agentIndex || 0, 0, POP_SIZE - 1);
    runsFinished = d.runsFinished || 0;
    totalLandings = d.totalLandings || 0;
    bestFitness = Number.isFinite(d.bestFitness) ? d.bestFitness : -Infinity;
    bestReplay = d.bestReplay || null;
    history = Array.isArray(d.history) ? d.history.slice(-100) : [];
    trickBook = d.trickBook || {};
    coachProfile = d.coachProfile || null;
    mutationSigma = d.mutationSigma || 0.15;
    stagnantGenerations = d.stagnantGenerations || 0;
    genomes = d.genomes;
    currentState = d.currentState || makeState();
    training = d.training === true;
  } catch (error) {
    if (error.code !== "ENOENT") console.error("Could not restore checkpoint:", error.message);
  }
}
function evolve() {
  genomes.sort((a, b) => b.fitness - a.fitness);
  const scores = genomes.map(g => g.fitness);
  const genBest = scores[0] || 0;
  const average = scores.reduce((sum, n) => sum + n, 0) / scores.length;
  if (genBest > bestFitness) {
    bestFitness = genBest;
    stagnantGenerations = 0;
    mutationSigma = Math.max(0.055, mutationSigma * 0.94);
  } else {
    stagnantGenerations++;
    if (stagnantGenerations >= 2) mutationSigma = Math.min(0.42, mutationSigma * 1.13);
  }
  history.push({ generation, best: Math.round(genBest), avg: Math.round(average) });
  if (history.length > 100) history.shift();
  const next = [cloneGenome(genomes[0]), cloneGenome(genomes[1])];
  while (next.length < POP_SIZE) next.push(mutate(crossover(tournament(genomes), tournament(genomes))));
  genomes = next;
  generation++;
  agentIndex = 0;
}
function completeRun() {
  const g = genomes[agentIndex];
  g.fitness = fitness(currentState);
  runsFinished++;
  if (!bestReplay || currentState.score > bestReplay.styleScore) {
    bestReplay = {
      score: Math.round(g.fitness),
      styleScore: Math.round(currentState.score),
      generation,
      rider: agentIndex + 1,
      landings: currentState.landings,
      rails: currentState.rails,
      missed: currentState.missed,
      frames: currentState.trace.length ? currentState.trace : [{
        z: currentState.z, x: currentState.x, vx: currentState.vx, speed: currentState.speed,
        height: currentState.height, rotation: currentState.rotation, airborne: currentState.airborne,
        rail: currentState.rail, score: currentState.score, combo: currentState.combo,
        lastTrick: currentState.lastTrick
      }]
    };
  }
  agentIndex++;
  if (agentIndex >= POP_SIZE) evolve();
  currentState = makeState();
}
function tick() {
  if (!training) return;
  for (let i = 0; i < STEPS_PER_TICK; i++) {
    if (currentState.done) {
      completeRun();
      continue;
    }
    advance(currentState, genomes[agentIndex]);
    if (currentState.done) completeRun();
  }
}
function safeStatus() {
  const state = currentState;
  return {
    connected: true,
    training,
    generation,
    rider: agentIndex + 1,
    population: POP_SIZE,
    runsFinished,
    totalLandings,
    bestScore: bestReplay ? bestReplay.styleScore : null,
    bestGeneration: bestReplay ? bestReplay.generation : null,
    bestRun: bestReplay ? {
      styleScore: bestReplay.styleScore, landings: bestReplay.landings,
      rails: bestReplay.rails, generation: bestReplay.generation,
      frameCount: bestReplay.frames.length
    } : null,
    mutationSigma: Number(mutationSigma.toFixed(3)),
    stagnantGenerations,
    current: {
      z: state.z, x: state.x, vx: state.vx, speed: state.speed,
      height: state.height, vy: state.vy, rotation: state.rotation,
      airborne: state.airborne, rail: state.rail, score: Math.round(state.score),
      landings: state.landings, rails: state.rails, crashes: state.crashes,
      lastTrick: state.lastTrick, done: state.done
    },
    history,
    tricks: Object.entries(trickBook).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, count]) => ({ name, count })),
    coachProfile: coachProfile ? {
      park: coachProfile.park,
      techniqueIndex: coachProfile.techniqueIndex,
      observedCleanLandingRate: coachProfile.observedCleanLandingRate,
      targetCleanLandingRate: coachProfile.targetCleanLandingRate,
      observedRepeatRate: coachProfile.observedRepeatRate,
      targetVariety: coachProfile.targetVariety,
      updatedAt: coachProfile.updatedAt
    } : null,
    lastCheckpoint: lastSavedAt ? new Date(lastSavedAt).toISOString() : null,
    serverTime: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime())
  };
}
function authorized(req) {
  const auth = req.headers.authorization || "";
  const supplied = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const a = Buffer.from(supplied), b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  res.end(JSON.stringify(body));
}
async function readJsonBody(req, maxBytes = 12000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  if (!size) return {};
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid JSON object.");
  return value;
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { status: "ok", service: "apex-bot-worker", training, uptimeSeconds: Math.round(process.uptime()) });
  }
  if (!url.pathname.startsWith("/api/")) return json(res, 404, { error: "Not found" });
  if (!authorized(req)) return json(res, 401, { error: "Unauthorized" });

  if (url.pathname.startsWith("/api/cork7/")) {
    const action = url.pathname.slice("/api/cork7/".length);
    try {
      if (req.method === "GET" && action === "status") {
        return json(res, 200, await cork7Agent.status({ screenshot: url.searchParams.get("screenshot") === "1" }));
      }
      if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
      const input = await readJsonBody(req, 8000);
      if (action === "start") {
        if (cork7Agent.page && !cork7Agent.page.isClosed()) {
          return json(res, 200, await cork7Agent.status({ screenshot: true }));
        }
        if (!cork7Agent.starting) {
          cork7Agent.starting = true;
          void cork7Agent.start({ park: input.park || "APEX" })
            .catch(error => { cork7Agent.lastError = String(error?.message || error).slice(0, 400); })
            .finally(() => { cork7Agent.starting = false; });
        }
        return json(res, 202, {
          connected: false,
          site: "cork7.com",
          mode: "Solo / unsigned browser session",
          park: input.park || "APEX",
          phase: "starting",
          starting: true,
          lastAction: "Launching the real Cork7 browser session",
          trainer: cork7Agent.trainerStatus(),
          capturedAt: new Date().toISOString()
        });
      }
      if (action === "act") return json(res, 200, await cork7Agent.act({ keys: input.keys, durationMs: input.durationMs }));
      if (action === "restart") return json(res, 200, await cork7Agent.restart());
      if (action === "train-start") {
        await cork7Agent.startTraining();
        return json(res, 200, await cork7Agent.status({ screenshot: true }));
      }
      if (action === "train-pause") {
        await cork7Agent.pauseTraining();
        return json(res, 200, await cork7Agent.status({ screenshot: true }));
      }
      if (action === "stop") return json(res, 200, await cork7Agent.close());
      return json(res, 404, { error: "Unknown Cork7 action" });
    } catch (error) {
      return json(res, 400, { error: String(error?.message || error).slice(0, 500) });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/status") return json(res, 200, safeStatus());
  if (req.method === "GET" && url.pathname === "/api/replay") {
    return bestReplay ? json(res, 200, bestReplay) : json(res, 404, { error: "No best run has been saved yet" });
  }

  if (req.method === "POST" && url.pathname === "/api/coach") {
    let input;
    try {
      input = await readJsonBody(req);
    } catch (error) {
      return json(res, 400, { error: error.message || "Invalid coach profile." });
    }
    const m = input.metrics && typeof input.metrics === "object" ? input.metrics : {};
    const total = clamp(Number(m.totalLandings) || 0, 0, 500);
    const clean = clamp(Number(m.cleanLandings) || 0, 0, total);
    const tricks = clamp(Number(m.tricks) || 0, 0, 500);
    const unique = clamp(Number(m.uniqueTricks) || 0, 0, tricks);
    const repeats = clamp(Number(m.repeatTricks) || 0, 0, tricks);
    const landingRate = total > 0 ? clean / total : 0.7;
    const repeatRate = tricks > 0 ? repeats / tricks : 0.25;
    const varietyRate = tricks > 0 ? unique / tricks : 0.45;
    coachProfile = {
      park: String(input.park || "Unknown").slice(0, 32),
      techniqueIndex: clamp(Math.round(Number(input.techniqueIndex) || 0), 0, 100),
      observedCleanLandingRate: Number(landingRate.toFixed(3)),
      targetCleanLandingRate: Number(clamp(landingRate + 0.12, 0.68, 0.95).toFixed(3)),
      observedRepeatRate: Number(repeatRate.toFixed(3)),
      targetVariety: Number(clamp(varietyRate + 0.15, 0.35, 0.9).toFixed(3)),
      updatedAt: new Date().toISOString()
    };
    cork7Agent.setCoachProfile(coachProfile);
    await saveState();
    await cork7Agent.saveTrainer().catch(error => console.error("Cork7 coach profile save failed:", error.message));
    return json(res, 200, { ok: true, message: "AI Lab training profile updated.", coachProfile });
  }

  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  if (url.pathname === "/api/start" || url.pathname === "/api/resume") {
    training = true;
    await saveState();
    return json(res, 200, { ok: true, ...safeStatus() });
  }
  if (url.pathname === "/api/pause") {
    training = false;
    await saveState();
    return json(res, 200, { ok: true, ...safeStatus() });
  }
  if (url.pathname === "/api/reset") {
    training = false;
    generation = 1; agentIndex = 0; runsFinished = 0; totalLandings = 0;
    bestFitness = -Infinity; bestReplay = null; history = []; trickBook = {};
    mutationSigma = 0.15; stagnantGenerations = 0;
    genomes = Array.from({ length: POP_SIZE }, makeGenome);
    currentState = makeState();
    await saveState();
    return json(res, 200, { ok: true, ...safeStatus() });
  }
  return json(res, 404, { error: "Unknown action" });
});

await loadState();
await cork7Agent.restoreTrainer();
server.listen(PORT, "0.0.0.0", () => {
  console.log("Apex bot worker listening on port " + PORT + "; restored generation " + generation + "; training=" + training);
});
setInterval(tick, TICK_MS);
setInterval(() => { if (training || Date.now() - lastSavedAt > 30000) void saveState(); }, 10000);
async function shutdown() {
  training = false;
  await saveState();
  await cork7Agent.close().catch(() => {});
  server.close(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
