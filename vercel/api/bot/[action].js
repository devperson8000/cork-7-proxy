const ALLOWED = new Set(["status", "replay", "start", "pause", "resume", "reset", "coach", "cork7-status", "cork7-snapshot", "cork7-start", "cork7-act", "cork7-restart", "cork7-stop", "cork7-train-start", "cork7-train-pause"]);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");

  const action = Array.isArray(req.query.action) ? req.query.action[0] : req.query.action;
  if (!ALLOWED.has(action)) return res.status(404).json({ error: "Unknown bot endpoint." });

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

  const expectedMethod = (action === "status" || action === "replay" || action === "cork7-status" || action === "cork7-snapshot") ? "GET" : "POST";
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
