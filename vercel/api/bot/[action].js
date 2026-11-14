import crypto from "node:crypto";
const ALLOWED = new Set(["status", "replay", "start", "pause", "resume", "reset", "coach", "owner-login", "owner-session", "owner-logout", "cork7-status", "cork7-snapshot", "cork7-start", "cork7-act", "cork7-restart", "cork7-stop", "cork7-train-start", "cork7-train-pause", "cork7-client-training"]);
const OWNER_COOKIE = "cork7_owner";
const SESSION_SECONDS = 7 * 24 * 60 * 60;
function ownerSignature(expiry) {
  const secret = process.env.CORK7_OWNER_PASSCODE || "";
  return crypto.createHmac("sha256", secret).update(String(expiry)).digest("base64url");
}
function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function cookieValue(req, name) {
  const raw = req.headers.cookie || "";
  for (const item of raw.split(";")) {
    const index = item.indexOf("=");
    if (index < 0) continue;
    if (item.slice(0, index).trim() === name) return decodeURIComponent(item.slice(index + 1).trim());
  }
  return "";
}
function isOwnerRequest(req) {
  const secret = process.env.CORK7_OWNER_PASSCODE || "";
  if (secret.length < 24) return false;
  const value = cookieValue(req, OWNER_COOKIE);
  const dot = value.indexOf(".");
  if (dot < 1) return false;
  const expiry = value.slice(0, dot), signature = value.slice(dot + 1);
  if (!/^\d{10,13}$/.test(expiry) || Number(expiry) < Math.floor(Date.now() / 1000)) return false;
  return safeEqual(signature, ownerSignature(expiry));
}
function ownerJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.end(JSON.stringify(body));
}
async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  return {};
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");

  const action = Array.isArray(req.query.action) ? req.query.action[0] : req.query.action;
  if (!ALLOWED.has(action)) return res.status(404).json({ error: "Unknown bot endpoint." });

  if (action === "owner-session") {
    if (req.method !== "GET") return ownerJson(res, 405, { error: "Method not allowed." });
    return ownerJson(res, 200, { authenticated: isOwnerRequest(req) });
  }
  if (action === "owner-logout") {
    if (req.method !== "POST") return ownerJson(res, 405, { error: "Method not allowed." });
    res.setHeader("Set-Cookie", OWNER_COOKIE + "=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict");
    return ownerJson(res, 200, { authenticated: false });
  }
  if (action === "owner-login") {
    if (req.method !== "POST") return ownerJson(res, 405, { error: "Method not allowed." });
    const expected = process.env.CORK7_OWNER_PASSCODE || "";
    if (expected.length < 24) return ownerJson(res, 503, { error: "Owner access has not been configured yet. Add CORK7_OWNER_PASSCODE as a sensitive Production environment variable in Vercel, then redeploy." });
    const body = await readBody(req);
    if (!safeEqual(body.passcode, expected)) return ownerJson(res, 401, { error: "That owner access code is not correct." });
    const expiry = String(Math.floor(Date.now() / 1000) + SESSION_SECONDS);
    const value = expiry + "." + ownerSignature(expiry);
    res.setHeader("Set-Cookie", OWNER_COOKIE + "=" + encodeURIComponent(value) + "; Path=/; Max-Age=" + SESSION_SECONDS + "; HttpOnly; Secure; SameSite=Strict");
    return ownerJson(res, 200, { authenticated: true, expiresIn: SESSION_SECONDS });
  }

  const expectedMethod = (action === "status" || action === "replay" || action === "cork7-status" || action === "cork7-snapshot") ? "GET" : "POST";
  if (req.method === "POST" && !isOwnerRequest(req)) {
    return ownerJson(res, 401, { error: "Owner access required. Unlock the dashboard to use training controls." });
  }

  const base = process.env.APEX_BOT_URL;
  const token = process.env.APEX_BOT_TOKEN;
  if (!base || !token) {
    return res.status(503).json({
      error: "Northflank worker is not connected yet. Add APEX_BOT_URL and APEX_BOT_TOKEN in Vercel after configuring the Northflank worker."
    });
  }

  let target;
  try {
    const parsed = new URL(base);
    if (parsed.protocol !== "https:") throw new Error("HTTPS required");
    const isCork7 = action.startsWith("cork7-");
    const suffix = isCork7 ? action.slice("cork7-".length) : action;
    target = new URL(isCork7 ? "/api/cork7/" + (suffix === "snapshot" ? "status" : suffix) : "/api/" + suffix, parsed.origin);
    if (action === "cork7-snapshot") target.searchParams.set("screenshot", "1");
  } catch {
    return res.status(500).json({ error: "APEX_BOT_URL must be a valid HTTPS Northflank service URL." });
  }

  if (req.method !== expectedMethod) {
    res.setHeader("Allow", expectedMethod);
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const upstream = await fetch(target, {
      method: expectedMethod,
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/json",
        ...(expectedMethod === "POST" ? { "Content-Type": "application/json" } : {})
      },
      body: expectedMethod === "POST" ? JSON.stringify(req.body || {}) : undefined,
      signal: AbortSignal.timeout(8000),
      cache: "no-store"
    });
    const body = await upstream.text();
    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
    return res.send(body);
  } catch {
    return res.status(502).json({ error: "Could not reach the Northflank worker. Check that its service is running and its public HTTPS port is configured." });
  }
};
