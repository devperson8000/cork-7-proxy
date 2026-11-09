import http from "node:http";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";

const HOST = "0.0.0.0";
const WISP_PATH = "/wisp/";
const DEFAULT_ALLOWED_HOSTS = "cork7.com,www.cork7.com";
const DEFAULT_ALLOWED_ORIGINS = "https://cork7game.vercel.app";

function parseCsv(value, variableName) {
  const entries = String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (entries.length === 0) {
    throw new Error(`${variableName} must contain at least one value.`);
  }

  return entries;
}

function parseAllowedHosts(value) {
  const hosts = parseCsv(value, "CORK7_ALLOWED_HOSTS").map((host) =>
    host.toLowerCase().replace(/\.$/, "")
  );

  for (const host of hosts) {
    const labels = host.split(".");
    const valid =
      host.length <= 253 &&
      labels.length >= 2 &&
      labels.every((label) =>
        /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
      );

    if (!valid) {
      throw new Error(
        `Invalid hostname in CORK7_ALLOWED_HOSTS: "${host}". Use exact hostnames; wildcards are not supported.`
      );
    }
  }

  return [...new Set(hosts)];
}

function normalizeOrigin(value) {
  const url = new URL(value);

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(`Invalid browser origin: "${value}". Supply an HTTPS origin only, such as https://example.com.`);
  }

  return url.origin;
}

function parseAllowedOrigins(value) {
  return new Set(
    parseCsv(value, "ALLOWED_ORIGINS").map(normalizeOrigin)
  );
}

function readPositiveInteger(value, variableName, fallback, max = 500) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`${variableName} must be an integer between 1 and ${max}.`);
  }

  return parsed;
}

function rejectUpgrade(socket, status, reason) {
  if (socket.destroyed) return;

  socket.end(
    `HTTP/1.1 ${status} ${reason}\r\n` +
      "Connection: close\r\n" +
      "Content-Length: 0\r\n" +
      "\r\n"
  );
}

const allowedHosts = parseAllowedHosts(
  process.env.CORK7_ALLOWED_HOSTS ?? DEFAULT_ALLOWED_HOSTS
);
const allowedOrigins = parseAllowedOrigins(
  process.env.ALLOWED_ORIGINS ?? DEFAULT_ALLOWED_ORIGINS
);
const port = readPositiveInteger(process.env.PORT, "PORT", 3000, 65535);
const maxWsConnections = readPositiveInteger(
  process.env.MAX_WS_CONNECTIONS,
  "MAX_WS_CONNECTIONS",
  60
);

// Restrict the Wisp server to the exact game hostnames and web ports.
wisp.options.hostname_whitelist = allowedHosts.map(
  (host) => new RegExp(`^${host.replaceAll(".", "\\.")}$`, "i")
);
wisp.options.port_whitelist = [80, 443];

// Explicitly block direct-IP, private-network, loopback, and UDP destinations.
wisp.options.allow_direct_ip = false;
wisp.options.allow_private_ips = false;
wisp.options.allow_loopback_ips = false;
wisp.options.allow_udp_streams = false;
wisp.options.allow_tcp_streams = true;

// Bound resource use for each connected browser session.
wisp.options.stream_limit_per_host = 16;
wisp.options.stream_limit_total = 64;
wisp.options.wisp_version = 2;

logging.set_level(logging.WARN);

let activeWsConnections = 0;

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;

  if (request.method === "GET" && pathname === "/health") {
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end(
      JSON.stringify({
        status: "ok",
        service: "cork7-wisp",
        websocketPath: WISP_PATH
      })
    );
    return;
  }

  response.writeHead(404, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end("Not found");
});

server.on("upgrade", (request, socket, head) => {
  // Compare the raw request target too: Wisp selects its protocol from the
  // trailing slash, so query strings or alternate paths must not be accepted.
  if (request.url !== WISP_PATH) {
    rejectUpgrade(socket, 404, "Not Found");
    return;
  }

  const originHeader = request.headers.origin;
  let origin;
  try {
    origin = typeof originHeader === "string"
      ? normalizeOrigin(originHeader)
      : "";
  } catch {
    origin = "";
  }

  if (!origin || !allowedOrigins.has(origin)) {
    rejectUpgrade(socket, 403, "Forbidden");
    return;
  }

  if (activeWsConnections >= maxWsConnections) {
    rejectUpgrade(socket, 429, "Too Many Connections");
    return;
  }

  activeWsConnections += 1;
  let counted = true;
  const releaseConnection = () => {
    if (!counted) return;
    counted = false;
    activeWsConnections = Math.max(0, activeWsConnections - 1);
  };

  socket.once("close", releaseConnection);
  socket.once("error", releaseConnection);

  try {
    wisp.routeRequest(request, socket, head);
  } catch (error) {
    releaseConnection();
    console.error("Wisp upgrade failed:", error);
    rejectUpgrade(socket, 500, "Internal Server Error");
  }
});

server.headersTimeout = 20_000;
server.requestTimeout = 30_000;
server.keepAliveTimeout = 10_000;

server.listen(port, HOST, () => {
  console.log(`Cork7 Wisp backend listening on ${HOST}:${port}`);
  console.log(`WebSocket endpoint: ${WISP_PATH}`);
  console.log(`Allowed destinations: ${allowedHosts.join(", ")}`);
  console.log(`Allowed browser origins: ${[...allowedOrigins].join(", ")}`);
});

function shutdown(signal) {
  console.log(`${signal} received; shutting down Cork7 Wisp backend.`);
  server.close(() => process.exit(0));
  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
