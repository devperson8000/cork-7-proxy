import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import tls from "node:tls";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";

const HOST = "0.0.0.0";
const WISP_PATH = "/wisp/";
const PLAYER_PATH = "/c7";
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(SERVER_DIR, "..");
const STATIC_ROOT = path.join(APP_ROOT, "packages", "demo", "dist");
const PLAYER_INDEX = path.join(STATIC_ROOT, "index.html");
const EXPECTED_PLAYER_BUILD = "c7-diagnostics-2026-11-09-1";
const CORK7_TLS_HOST = "cork7.com";
const DEFAULT_ALLOWED_HOSTS =
  "cork7.com,www.cork7.com,live.cork7.com";
const DEFAULT_ALLOWED_ORIGINS = "https://cork7game.vercel.app";
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8"
};

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
    throw new Error(
      `Invalid browser origin: "${value}". Supply an HTTPS origin only, such as https://example.com.`
    );
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

function setHealthCors(request, response, allowedOrigins) {
  const requestOrigin = request.headers.origin;
  if (typeof requestOrigin !== "string") return;

  try {
    const origin = normalizeOrigin(requestOrigin);
    if (allowedOrigins.has(origin)) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
    }
  } catch {
    // Invalid or non-HTTPS browser origins receive no CORS permission.
  }
}


function readHtmlAttribute(tag, name) {
  const attributes = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tag.matchAll(attributes)) {
    if (match[1].toLowerCase() === name.toLowerCase()) {
      return match[2] ?? match[3] ?? match[4] ?? null;
    }
  }
  return null;
}

function probeCork7Tls(timeoutMs = 5000) {
  return new Promise((resolve) => {
    let settled = false;
    let socket;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (socket && !socket.destroyed) socket.destroy();
      resolve(result);
    };

    socket = tls.connect({
      host: CORK7_TLS_HOST,
      port: 443,
      servername: CORK7_TLS_HOST,
      rejectUnauthorized: true
    });

    socket.setTimeout(timeoutMs, () => {
      finish({
        ok: false,
        code: "ETIMEDOUT",
        error: "TLS connection to " + CORK7_TLS_HOST + ":443 timed out after " + timeoutMs + "ms"
      });
    });

    socket.once("secureConnect", () => {
      finish({
        ok: socket.authorized === true,
        protocol: socket.getProtocol(),
        authorized: socket.authorized,
        authorizationError: socket.authorizationError ?? null
      });
    });

    socket.once("error", (error) => {
      finish({
        ok: false,
        code: error.code ?? null,
        error: error.message
      });
    });
  });
}

async function inspectPlayerBuild() {
  try {
    const html = await fs.readFile(PLAYER_INDEX, "utf8");
    const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
    const buildMeta = metaTags.find(
      (tag) => readHtmlAttribute(tag, "name")?.toLowerCase() === "c7-build"
    );
    const buildId =
      readHtmlAttribute(buildMeta ?? "", "content") ??
      (html.includes("C7 // RUNTIME DIAGNOSTICS · " + EXPECTED_PLAYER_BUILD)
        ? EXPECTED_PLAYER_BUILD
        : null);
    const diagnosticsPanelPresent = html.includes('id="c7-diagnostics"');

    const scriptTags = html.match(/<script\b[^>]*>/gi) ?? [];
    const moduleTag = scriptTags.find(
      (tag) => readHtmlAttribute(tag, "type")?.toLowerCase() === "module"
    );
    let moduleSrc = readHtmlAttribute(moduleTag ?? "", "src");

    if (!moduleSrc) {
      const bundledScript = scriptTags.find((tag) => {
        const src = readHtmlAttribute(tag, "src");
        return src && /(?:^|\/)assets\/[^/]+\.js(?:[?#].*)?$/i.test(src);
      });
      moduleSrc = readHtmlAttribute(bundledScript ?? "", "src");
    }

    let moduleAssetPresent = false;
    let moduleAsset = null;

    if (moduleSrc) {
      const pageUrl = new URL(PLAYER_PATH + "/", "http://localhost");
      const moduleUrl = new URL(moduleSrc, pageUrl);
      if (
        moduleUrl.origin === pageUrl.origin &&
        moduleUrl.pathname.startsWith(PLAYER_PATH + "/")
      ) {
        const relative = decodeURIComponent(
          moduleUrl.pathname.slice(PLAYER_PATH.length + 1)
        );
        const resolved = path.resolve(STATIC_ROOT, relative);
        if (resolved.startsWith(STATIC_ROOT + path.sep)) {
          moduleAsset = relative;
          moduleAssetPresent = existsSync(resolved);
        }
      }
    }

    const requiredAssets = [
      "sw.js",
      "controller/controller.sw.js",
      "controller/controller.inject.js",
      "controller/controller.api.js",
      "scramjet/scramjet.js",
      "scramjet/scramjet.wasm"
    ];
    const missingAssets = requiredAssets.filter((asset) =>
      !existsSync(path.join(STATIC_ROOT, asset))
    );
    const indexHash = createHash("sha256").update(html).digest("hex").slice(0, 16);
    const checksPass =
      buildId === EXPECTED_PLAYER_BUILD &&
      diagnosticsPanelPresent &&
      moduleAssetPresent &&
      missingAssets.length === 0;

    return {
      buildId,
      expectedBuildId: EXPECTED_PLAYER_BUILD,
      buildMetaFound: Boolean(buildMeta),
      diagnosticsPanelPresent,
      moduleSrc,
      moduleTagFound: Boolean(moduleTag),
      moduleAsset,
      moduleAssetPresent,
      missingAssets,
      indexHash,
      playerReady: checksPass
    };
  } catch (error) {
    return {
      buildId: null,
      expectedBuildId: EXPECTED_PLAYER_BUILD,
      buildMetaFound: false,
      diagnosticsPanelPresent: false,
      moduleSrc: null,
      moduleTagFound: false,
      moduleAsset: null,
      moduleAssetPresent: false,
      missingAssets: ["index.html or player build could not be inspected"],
      error: error instanceof Error ? error.message : String(error),
      playerReady: false
    };
  }
}
async function servePlayerAsset(pathname, response) {
  let relativePath;
  try {
    relativePath = decodeURIComponent(pathname.slice(PLAYER_PATH.length + 1));
  } catch {
    response.writeHead(400, { "Cache-Control": "no-store" });
    response.end("Invalid path");
    return;
  }

  if (!relativePath || relativePath === "/") {
    relativePath = "index.html";
  }

  const requestedPath = path.resolve(STATIC_ROOT, relativePath);
  if (
    requestedPath !== STATIC_ROOT &&
    !requestedPath.startsWith(STATIC_ROOT + path.sep)
  ) {
    response.writeHead(403, { "Cache-Control": "no-store" });
    response.end("Forbidden");
    return;
  }

  try {
    let filePath = requestedPath;
    let info = await fs.stat(filePath);
    if (info.isDirectory()) {
      filePath = path.join(filePath, "index.html");
      info = await fs.stat(filePath);
    }

    if (!info.isFile()) throw new Error("Not a file");

    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] ?? "application/octet-stream",
      "Content-Length": info.size,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(await fs.readFile(filePath));
  } catch {
    response.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end("Player asset not found");
  }
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

// Restrict Wisp to exact Cork7 hostnames and standard web ports.
wisp.options.hostname_whitelist = allowedHosts.map(
  (host) => new RegExp(`^${host.replaceAll(".", "\\.")}$`, "i")
);
wisp.options.port_whitelist = [80, 443];

// Do not permit direct IP, private-network, loopback, or UDP destinations.
wisp.options.allow_direct_ip = false;
wisp.options.allow_private_ips = false;
wisp.options.allow_loopback_ips = false;
wisp.options.allow_udp_streams = false;
wisp.options.allow_tcp_streams = true;

// Per-connection resource limits.
wisp.options.stream_limit_per_host = 16;
wisp.options.stream_limit_total = 64;
wisp.options.wisp_version = 2;

logging.set_level(logging.INFO);

let activeWsConnections = 0;

const server = http.createServer(async (request, response) => {
  let pathname;
  try {
    pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  } catch {
    response.writeHead(400, { "Cache-Control": "no-store" });
    response.end("Bad request");
    return;
  }

  if (request.method === "GET" && pathname === "/health") {
    setHealthCors(request, response, allowedOrigins);
    const [playerDiagnostics, cork7TlsProbe] = await Promise.all([
      inspectPlayerBuild(),
      probeCork7Tls()
    ]);
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end(
      JSON.stringify({
        status: "ok",
        service: "cork7-wisp",
        player: "/c7/",
        playerReady: playerDiagnostics.playerReady,
        playerDiagnostics,
        cork7TlsProbe,
        websocketPath: WISP_PATH
      })
    );
    return;
  }

  if (request.method === "GET" && pathname === PLAYER_PATH) {
    response.writeHead(308, {
      Location: PLAYER_PATH + "/",
      "Cache-Control": "no-store"
    });
    response.end();
    return;
  }

  if (
    request.method === "GET" &&
    (pathname === PLAYER_PATH + "/" || pathname.startsWith(PLAYER_PATH + "/"))
  ) {
    void servePlayerAsset(pathname, response);
    return;
  }

  response.writeHead(404, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end("Not found");
});

server.on("upgrade", (request, socket, head) => {
  // Only the dedicated Wisp endpoint accepts WebSocket upgrades.
  if (request.url !== WISP_PATH) {
    console.warn(`Rejected WebSocket upgrade for path "${request.url}"; expected "${WISP_PATH}".`);
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
    console.warn(`Rejected Wisp upgrade: origin "${originHeader ?? "(missing)"}" is not allowed.`);
    rejectUpgrade(socket, 403, "Forbidden");
    return;
  }

  if (activeWsConnections >= maxWsConnections) {
    rejectUpgrade(socket, 429, "Too Many Connections");
    return;
  }

  activeWsConnections += 1;
  console.info(
    `Accepted Wisp upgrade from ${origin}; protocol=${request.headers["sec-websocket-protocol"] ?? "(none)"}; active=${activeWsConnections}`
  );
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
  console.log(`Cork7 player and Wisp backend listening on ${HOST}:${port}`);
  console.log(`Player path: ${PLAYER_PATH}/`);
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
