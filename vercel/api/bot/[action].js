const ALLOWED = new Set(["status", "replay", "start", "pause", "resume", "reset"]);

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");

  const action = Array.isArray(req.query.action) ? req.query.action[0] : req.query.action;
  if (!ALLOWED.has(action)) return res.status(404).json({ error: "Unknown bot endpoint." });

  const base = process.env.APEX_BOT_URL;
  const token = process.env.APEX_BOT_TOKEN;
  if (!base || !token) {
    return res.status(503).json({
      error: "Northflank worker is not connected yet. Finish the service setup and add APEX_BOT_URL in Vercel."
    });
  }

  let target;
  try {
    const parsed = new URL(base);
    if (parsed.protocol !== "https:") throw new Error("HTTPS required");
    target = new URL("/api/" + action, parsed.origin);
  } catch {
    return res.status(500).json({ error: "APEX_BOT_URL must be a valid HTTPS Northflank service URL." });
  }

  const expectedMethod = (action === "status" || action === "replay") ? "GET" : "POST";
  if (req.method !== expectedMethod) {
    res.setHeader("Allow", expectedMethod);
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const upstream = await fetch(target, {
      method: expectedMethod,
      headers: { Authorization: "Bearer " + token, Accept: "application/json" },
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
