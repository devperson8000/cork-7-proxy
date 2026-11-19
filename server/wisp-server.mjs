import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { createHash, timingSafeEqual } from "node:crypto";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";

const HOST = "0.0.0.0";
const WISP_PATH = "/wisp/";
const PLAYER_PATH = "/c7";
const SALTYSEAS_PLAYER_PATH = "/saltyseas-player";
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(SERVER_DIR, "..");
const STATIC_ROOT = path.join(APP_ROOT, "packages", "demo", "dist");
const PLAYER_INDEX = path.join(STATIC_ROOT, "index.html");

const DEFAULT_ALLOWED_HOSTS = "cork7.com,www.cork7.com,live.cork7.com,agfhgulgtsocvioqqxvi.supabase.co,saltyseas.io,cdn.saltyseas.io,api-eu-1.saltyseas.io,accounts.google.com,www.googletagmanager.com";
const DEFAULT_ALLOWED_ORIGINS = "https://cork7game.vercel.app";
const SUPABASE_API_HOST = "agfhgulgtsocvioqqxvi.supabase.co";
const SALTYSEAS_TARGET_URL = "https://saltyseas.io/app/";
const SALTYSEAS_HOST = "saltyseas.io";
const SALTYSEAS_CDN_HOST = "cdn.saltyseas.io";
const SALTYSEAS_API_EU_HOST = "api-eu-1.saltyseas.io";
const GOOGLE_ACCOUNTS_HOST = "accounts.google.com";
const GOOGLE_TAG_MANAGER_HOST = "www.googletagmanager.com";

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
	".txt": "text/plain; charset=utf-8",
};

function parseCsv(value, variableName) {
	const entries = String(value ?? "")
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);

	if (entries.length === 0) {
		throw new Error(variableName + " must contain at least one value.");
	}
	return entries;
}

function parseAllowedHosts(value) {
	const hosts = parseCsv(value, "CORK7_ALLOWED_HOSTS").map((host) =>
		host.toLowerCase().replace(/\.$/, ""),
	);

	for (const host of hosts) {
		const labels = host.split(".");
		const valid =
			host.length <= 253 &&
			labels.length >= 2 &&
			labels.every((label) =>
				/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
			);

		if (!valid) {
			throw new Error(
				'Invalid hostname in CORK7_ALLOWED_HOSTS: "' + host + '". Use exact hostnames; wildcards are not supported.',
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
			'Invalid browser origin: "' + value + '". Supply an HTTPS origin only.',
		);
	}
	return url.origin;
}

function parseAllowedOrigins(value) {
	return new Set(
		parseCsv(value, "ALLOWED_ORIGINS").map(normalizeOrigin),
	);
}

function parseTargetUrl(value, allowedHosts) {
	const raw = String(value ?? "").trim();
	if (!raw) throw new Error("CORK7_TARGET_URL must be a non-empty HTTPS URL.");

	let target;
	try {
		target = new URL(raw);
	} catch {
		throw new Error("CORK7_TARGET_URL must be a valid absolute HTTPS URL.");
	}

	if (
		target.protocol !== "https:" ||
		target.username ||
		target.password ||
		(target.port !== "" && target.port !== "443")
	) {
		throw new Error("CORK7_TARGET_URL must use HTTPS on the standard port and cannot contain credentials.");
	}

	const hostname = target.hostname.toLowerCase().replace(/\.$/, "");
	if (!allowedHosts.includes(hostname)) {
		throw new Error(
			"CORK7_TARGET_URL host \"" + hostname + "\" is not in CORK7_ALLOWED_HOSTS.",
		);
	}

	target.hash = "";
	return target.href;
}

function runtimeConfigScript(targetUrl, allowedHosts) {
	const payload = JSON.stringify({
		site: new URL(targetUrl).hostname.toLowerCase() === SALTYSEAS_HOST ? "saltyseas" : "cork7",
		targetUrl,
		allowedHosts,
	})
		.replace(/</g, "\\u003c")
		.replace(/\u2028/g, "\\u2028")
		.replace(/\u2029/g, "\\u2029");
	return "<script>window.CORK7_CONFIG = Object.freeze(" + payload + ");</script>";
}

function injectRuntimeConfig(html, targetUrl, allowedHosts) {
	const marker = "</head>";
	const position = html.toLowerCase().lastIndexOf(marker);
	const script = runtimeConfigScript(targetUrl, allowedHosts);
	if (position === -1) return script + html;
	return html.slice(0, position) + script + html.slice(position);
}

function readPositiveInteger(value, variableName, fallback, max = 500) {
	const parsed = value === undefined || value === "" ? fallback : Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
		throw new Error(variableName + " must be an integer between 1 and " + max + ".");
	}
	return parsed;
}

function rejectUpgrade(socket, status, reason) {
	if (socket.destroyed) return;
	socket.end(
		"HTTP/1.1 " + status + " " + reason + "\r\n" +
		"Connection: close\r\n" +
		"Content-Length: 0\r\n" +
		"\r\n",
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


const MAX_NETWORK_DIAGNOSTICS = 500;
const networkDiagnostics = [];
const streamDiagnostics = new Map();
let networkDiagnosticSequence = 0;
const NETWORK_DIAGNOSTICS_TOKEN = String(process.env.NETWORK_DIAGNOSTICS_TOKEN ?? "");

const WISP_CLOSE_REASON_LABELS = {
	1: "Unknown",
	2: "Voluntary",
	3: "NetworkError",
	65: "InvalidInfo",
	66: "UnreachableHost",
	67: "NoResponse",
	68: "ConnRefused",
	71: "TransferTimeout",
	72: "HostBlocked",
	73: "ConnThrottled",
};

function pushNetworkDiagnostic(event) {
	const entry = {
		id: ++networkDiagnosticSequence,
		timestamp: new Date().toISOString(),
		...event,
	};
	networkDiagnostics.push(entry);
	if (networkDiagnostics.length > MAX_NETWORK_DIAGNOSTICS) {
		networkDiagnostics.splice(0, networkDiagnostics.length - MAX_NETWORK_DIAGNOSTICS);
	}
	console.info("[network-diagnostic] " + JSON.stringify(entry));
	return entry;
}

function streamDiagnosticKey(connectionId, streamId) {
	return String(connectionId) + ":" + String(streamId);
}

function reasonLabel(reason) {
	return WISP_CLOSE_REASON_LABELS[Number(reason)] ?? "Unknown reason";
}

function isDiagnosticsAuthorized(request) {
	if (!NETWORK_DIAGNOSTICS_TOKEN) return false;
	const header = request.headers.authorization;
	if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
	const supplied = Buffer.from(header.slice(7));
	const expected = Buffer.from(NETWORK_DIAGNOSTICS_TOKEN);
	return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function sendDiagnosticsUnauthorized(response) {
	response.writeHead(NETWORK_DIAGNOSTICS_TOKEN ? 401 : 404, {
		"Content-Type": "text/plain; charset=utf-8",
		"Cache-Control": "no-store",
		"WWW-Authenticate": "Bearer",
	});
	response.end(NETWORK_DIAGNOSTICS_TOKEN ? "Diagnostics authorization required" : "Diagnostics are disabled");
}

const NETWORK_DIAGNOSTICS_PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cork7 Network Diagnostics</title>
<style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#0b1020;color:#e7ecf7}
*{box-sizing:border-box}body{margin:0;padding:28px;max-width:1200px;margin-inline:auto}
h1{font-size:24px;margin:0 0 8px}.sub{color:#9aa8c4;margin:0 0 24px}
.panel{background:#121a2d;border:1px solid #27334c;border-radius:14px;padding:16px;margin:14px 0}
.controls{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
input{background:#0b1020;color:#e7ecf7;border:1px solid #35425f;border-radius:8px;padding:10px;min-width:260px}
button{background:#315bd6;color:white;border:0;border-radius:8px;padding:10px 14px;cursor:pointer}
button.secondary{background:#293550}button:disabled{opacity:.5;cursor:wait}
#message{color:#aab7d0;margin-top:10px;font-size:13px}
.stats{display:flex;gap:12px;flex-wrap:wrap}.stat{background:#0b1020;border:1px solid #27334c;border-radius:10px;padding:12px 16px;min-width:130px}
.stat b{display:block;font-size:20px}.stat span{color:#9aa8c4;font-size:12px}
.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px;white-space:nowrap}
th,td{text-align:left;border-bottom:1px solid #27334c;padding:10px 12px}th{color:#9aa8c4;font-weight:600;position:sticky;top:0;background:#121a2d}
.status{font-weight:700}.connected{color:#62d69a}.blocked{color:#ffbd63}.failed{color:#ff7777}.pending{color:#9ab7ff}.closed{color:#aab7d0}
code{color:#d8e1ff}.empty{padding:28px;text-align:center;color:#9aa8c4}
@media(max-width:600px){body{padding:16px}.panel{padding:12px}}
</style>
</head>
<body>
<h1>Cork7 Network Diagnostics</h1>
<p class="sub">Live Wisp stream events for this service. The log is kept in memory and retains the latest 500 events.</p>
<section class="panel">
<div class="controls">
<input id="token" type="password" autocomplete="off" placeholder="Diagnostics access token" aria-label="Diagnostics access token">
<button id="connect">Connect</button>
<button id="refresh" class="secondary" disabled>Refresh</button>
<button id="clear" class="secondary" disabled>Clear log</button>
</div>
<div id="message">Enter the token configured in the service environment to view diagnostics.</div>
</section>
<section class="panel">
<div class="stats">
<div class="stat"><b id="total">—</b><span>Events shown</span></div>
<div class="stat"><b id="connected">—</b><span>Connected</span></div>
<div class="stat"><b id="blocked">—</b><span>Blocked</span></div>
<div class="stat"><b id="failed">—</b><span>Failed</span></div>
</div>
</section>
<section class="panel table-wrap">
<table>
<thead><tr><th>Time</th><th>Host</th><th>Port</th><th>Event</th><th>Status</th><th>Reason / details</th><th>Connection</th></tr></thead>
<tbody id="events"><tr><td colspan="7" class="empty">Connect to load events.</td></tr></tbody>
</table>
</section>
<script>
(function(){
 const tokenInput=document.getElementById("token");
 const message=document.getElementById("message");
 const tbody=document.getElementById("events");
 let token="";
 let timer=null;
 function esc(value){
  return String(value==null?"":value).replace(/[&<>"']/g,function(ch){
   return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch];
  });
 }
 function render(data){
  const entries=data.events||[];
  document.getElementById("total").textContent=entries.length;
  document.getElementById("connected").textContent=entries.filter(e=>e.status==="connected").length;
  document.getElementById("blocked").textContent=entries.filter(e=>e.status==="blocked").length;
  document.getElementById("failed").textContent=entries.filter(e=>e.status==="failed").length;
  if(!entries.length){tbody.innerHTML='<tr><td colspan="7" class="empty">No network events recorded yet.</td></tr>';return;}
  tbody.innerHTML=entries.map(function(e){
   const cls=["connected","blocked","failed","pending","closed"].includes(e.status)?e.status:"";
   const date=new Date(e.timestamp);
   return "<tr><td>"+esc(date.toLocaleTimeString())+"</td><td><code>"+esc(e.host)+"</code></td><td>"+esc(e.port)+"</td><td>"+esc(e.event)+"</td><td class='status "+cls+"'>"+esc(e.status)+"</td><td>"+esc(e.reason||e.detail||"—")+"</td><td>"+esc(e.connectionId)+"/"+esc(e.streamId)+"</td></tr>";
  }).join("");
 }
 async function api(path,method){
  const response=await fetch(path,{method:method||"GET",headers:{"Authorization":"Bearer "+token}});
  if(response.status===401)throw new Error("Token was not accepted.");
  if(!response.ok)throw new Error("Diagnostics request failed ("+response.status+").");
  return response.json();
 }
 async function refresh(){
  try{const data=await api("/diagnostics/network-api?limit=250");render(data);message.textContent="Connected · updated "+new Date().toLocaleTimeString();}
  catch(error){message.textContent=error.message;if(timer){clearInterval(timer);timer=null;}}
 }
 document.getElementById("connect").addEventListener("click",async function(){
  token=tokenInput.value.trim();
  if(!token){message.textContent="Enter the diagnostics token first.";return;}
  this.disabled=true;
  try{
   await refresh();
   document.getElementById("refresh").disabled=false;
   document.getElementById("clear").disabled=false;
   if(!timer)timer=setInterval(refresh,2500);
  }finally{this.disabled=false;}
 });
 document.getElementById("refresh").addEventListener("click",refresh);
 document.getElementById("clear").addEventListener("click",async function(){
  if(!token||!confirm("Clear the in-memory network log?"))return;
  try{await api("/diagnostics/network-api/clear","POST");await refresh();}
  catch(error){message.textContent=error.message;}
 });
 tokenInput.addEventListener("keydown",function(event){if(event.key==="Enter")document.getElementById("connect").click();});
 window.addEventListener("beforeunload",function(){if(timer)clearInterval(timer);token="";});
})();
</script>
</body>
</html>`;

function readHtmlAttribute(tag, name) {
	const attributes = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
	for (const match of tag.matchAll(attributes)) {
		if (match[1].toLowerCase() === name.toLowerCase()) {
			return match[2] ?? match[3] ?? match[4] ?? null;
		}
	}
	return null;
}

const REQUIRED_PLAYER_ASSETS = [
	"sw.js",
	"controller/controller.sw.js",
	"controller/controller.inject.js",
	"controller/controller.api.js",
	"scramjet/scramjet.js",
	"scramjet/scramjet.wasm",
];

async function inspectPlayerBuild() {
	try {
		const html = await fs.readFile(PLAYER_INDEX, "utf8");
		const scriptTags = html.match(/<script\b[^>]*>/gi) ?? [];
		const moduleTag = scriptTags.find(
			(tag) => readHtmlAttribute(tag, "type")?.toLowerCase() === "module",
		);
		const moduleSrc = readHtmlAttribute(moduleTag ?? "", "src");
		let moduleAssetPresent = false;

		if (moduleSrc) {
			const pageUrl = new URL(PLAYER_PATH + "/", "http://localhost");
			const moduleUrl = new URL(moduleSrc, pageUrl);
			if (
				moduleUrl.origin === pageUrl.origin &&
				moduleUrl.pathname.startsWith(PLAYER_PATH + "/")
			) {
				const relative = decodeURIComponent(
					moduleUrl.pathname.slice(PLAYER_PATH.length + 1),
				);
				const resolved = path.resolve(STATIC_ROOT, relative);
				if (resolved.startsWith(STATIC_ROOT + path.sep)) {
					moduleAssetPresent = existsSync(resolved);
				}
			}
		}

		const missingAssets = REQUIRED_PLAYER_ASSETS.filter(
			(asset) => !existsSync(path.join(STATIC_ROOT, asset)),
		);
		if (!moduleAssetPresent) missingAssets.push("player entry module");

		return {
			playerReady: missingAssets.length === 0,
			moduleAssetPresent,
			missingAssets,
		};
	} catch {
		return {
			playerReady: false,
			moduleAssetPresent: false,
			missingAssets: ["player build is missing or unreadable"],
		};
	}
}

async function servePlayerAsset(pathname, request, response, pageTargetUrl) {
	let relativePath;
	try {
		relativePath = decodeURIComponent(pathname.slice(PLAYER_PATH.length + 1));
	} catch {
		response.writeHead(400, { "Cache-Control": "no-store" });
		response.end("Invalid path");
		return;
	}

	if (!relativePath || relativePath === "/") relativePath = "index.html";

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
		const relative = path.relative(STATIC_ROOT, filePath).split(path.sep).join("/");
		const isIndex = relative === "index.html";
		const isFingerprintedAsset =
			/^assets\/.+-[a-zA-Z0-9_-]{6,}\.(?:js|css)$/.test(relative);
		const mustRevalidate =
			isIndex ||
			relative === "sw.js" ||
			relative.startsWith("controller/") ||
			relative.startsWith("scramjet/");
		const cacheControl = isFingerprintedAsset
			? "public, max-age=31536000, immutable"
			: mustRevalidate
				? "no-cache"
				: "public, max-age=86400";

		const content = isIndex
			? Buffer.from(
				injectRuntimeConfig(
					await fs.readFile(filePath, "utf8"),
					pageTargetUrl,
					allowedHosts,
				),
				"utf8",
			)
			: await fs.readFile(filePath);
		const etag = isIndex
			? '"' + createHash("sha256").update(content).digest("base64url") + '"'
			: '"' + info.size.toString(16) + "-" + Math.trunc(info.mtimeMs).toString(16) + '"';
		const validators = {
			ETag: etag,
			"Last-Modified": info.mtime.toUTCString(),
			"Cache-Control": cacheControl,
			"X-Content-Type-Options": "nosniff",
		};
		const ifNoneMatch = request.headers["if-none-match"];
		if (
			typeof ifNoneMatch === "string" &&
			ifNoneMatch.split(",").map((value) => value.trim()).includes(etag)
		) {
			response.writeHead(304, validators);
			response.end();
			return;
		}

		response.writeHead(200, {
			...validators,
			"Content-Type": MIME_TYPES[extension] ?? "application/octet-stream",
			"Content-Length": content.byteLength,
		});
		response.end(content);
	} catch {
		response.writeHead(404, {
			"Content-Type": "text/plain; charset=utf-8",
			"Cache-Control": "no-store",
		});
		response.end("Player asset not found");
	}
}

// Keep the one observed Cork7 account/API host available even when
// Northflank has an older CORK7_ALLOWED_HOSTS value configured. This is
// still an exact-host allowlist; no wildcard Supabase access is granted.
const allowedHosts = [
	...new Set([
		...parseAllowedHosts(
			process.env.CORK7_ALLOWED_HOSTS ?? DEFAULT_ALLOWED_HOSTS,
		),
		SUPABASE_API_HOST,
		SALTYSEAS_HOST,
		SALTYSEAS_CDN_HOST,
		SALTYSEAS_API_EU_HOST,
		GOOGLE_ACCOUNTS_HOST,
		GOOGLE_TAG_MANAGER_HOST,
	]),
];
const allowedOrigins = parseAllowedOrigins(
	process.env.ALLOWED_ORIGINS ?? DEFAULT_ALLOWED_ORIGINS,
);
const targetUrl = parseTargetUrl(
	process.env.CORK7_TARGET_URL ?? "https://cork7.com/",
	allowedHosts,
);
const port = readPositiveInteger(process.env.PORT, "PORT", 3000, 65535);
const maxWsConnections = readPositiveInteger(
	process.env.MAX_WS_CONNECTIONS,
	"MAX_WS_CONNECTIONS",
	60,
);

// Wisp 0.4.1 iterates connection.streams in its per-host limiter, while its
// connection stores streams in a plain object. Make the object iterable without
// changing its keys or the existing connection/stream accounting.
const originalCreateWispStream = wisp.ServerConnection.prototype.create_stream;
if (typeof originalCreateWispStream !== "function") {
	throw new Error("Unsupported Wisp server package: create_stream is unavailable.");
}
wisp.ServerConnection.prototype.create_stream = function (...args) {
	if (
		this.streams &&
		typeof this.streams[Symbol.iterator] !== "function"
	) {
		Object.defineProperty(this.streams, Symbol.iterator, {
			configurable: true,
			enumerable: false,
			value: function* streamValues() {
				yield* Object.values(this);
			},
		});
	}
	const [streamId, streamType, hostname, port] = args;
	const host = String(hostname ?? "").trim().toLowerCase();
	const key = streamDiagnosticKey(this.conn_id, streamId);
	const metadata = {
		connectionId: this.conn_id,
		streamId,
		host,
		port,
		streamType: Number(streamType) === 1 ? "TCP" : "UDP",
		startedAt: Date.now(),
	};
	streamDiagnostics.set(key, metadata);
	pushNetworkDiagnostic({
		event: "request",
		status: "pending",
		connectionId: metadata.connectionId,
		streamId: metadata.streamId,
		host: metadata.host,
		port: metadata.port,
		detail: metadata.streamType,
	});
	return originalCreateWispStream.apply(this, args);
};

if (wisp.ServerStream?.prototype?.setup) {
	const originalSetupWispStream = wisp.ServerStream.prototype.setup;
	wisp.ServerStream.prototype.setup = async function (ipString) {
		const metadata = streamDiagnostics.get(
			streamDiagnosticKey(this.conn.conn_id, this.stream_id),
		);
		const startedAt = Date.now();
		try {
			const result = await originalSetupWispStream.call(this, ipString);
			pushNetworkDiagnostic({
				event: "connect",
				status: "connected",
				connectionId: metadata?.connectionId ?? this.conn.conn_id,
				streamId: this.stream_id,
				host: this.socket.hostname,
				port: this.socket.port,
				durationMs: Date.now() - (metadata?.startedAt ?? startedAt),
			});
			return result;
		} catch (error) {
			pushNetworkDiagnostic({
				event: "connect",
				status: "failed",
				connectionId: metadata?.connectionId ?? this.conn.conn_id,
				streamId: this.stream_id,
				host: this.socket.hostname,
				port: this.socket.port,
				durationMs: Date.now() - (metadata?.startedAt ?? startedAt),
				reason: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	};
}

const originalCloseWispStream = wisp.ServerConnection.prototype.close_stream;
if (typeof originalCloseWispStream === "function") {
	wisp.ServerConnection.prototype.close_stream = async function (
		streamId,
		reason = null,
		sendPacket = true,
	) {
		const stream = this.streams?.[streamId];
		const metadata = streamDiagnostics.get(streamDiagnosticKey(this.conn_id, streamId));
		if (stream || metadata) {
			const host = stream?.socket?.hostname ?? metadata?.host ?? "";
			const port = stream?.socket?.port ?? metadata?.port ?? null;
			const reasonText = reason == null ? "Connection ended" : reasonLabel(reason);
			let status = "closed";
			if (Number(reason) === 72) status = "blocked";
			else if (reason != null && Number(reason) !== 2) status = "failed";
			pushNetworkDiagnostic({
				event: "close",
				status,
				connectionId: this.conn_id,
				streamId,
				host,
				port,
				reason: reasonText + (reason == null ? "" : " (" + Number(reason) + ")"),
				durationMs: metadata ? Date.now() - metadata.startedAt : undefined,
			});
			streamDiagnostics.delete(streamDiagnosticKey(this.conn_id, streamId));
		}
		return originalCloseWispStream.call(this, streamId, reason, sendPacket);
	};
}

// Keep Wisp restricted to the exact approved destination hosts and standard web ports.
wisp.options.hostname_whitelist = allowedHosts.map(
	(host) => new RegExp("^" + host.replaceAll(".", "\\.") + "$", "i"),
);
wisp.options.port_whitelist = [80, 443];
wisp.options.allow_direct_ip = false;
wisp.options.allow_private_ips = false;
wisp.options.allow_loopback_ips = false;
wisp.options.allow_udp_streams = false;
wisp.options.allow_tcp_streams = true;
wisp.options.stream_limit_per_host = 16;
wisp.options.stream_limit_total = 64;
wisp.options.wisp_version = 2;
wisp.options.dns_result_order = "ipv4first";

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


	if (
		request.method === "GET" &&
		(pathname === "/diagnostics" || pathname === "/diagnostics/")
	) {
		response.writeHead(200, {
			"Content-Type": "text/html; charset=utf-8",
			"Cache-Control": "no-store",
			"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
			"X-Content-Type-Options": "nosniff",
		});
		response.end(NETWORK_DIAGNOSTICS_PAGE);
		return;
	}

	if (
		pathname === "/diagnostics/network-api" ||
		pathname === "/diagnostics/network-api/clear"
	) {
		if (!isDiagnosticsAuthorized(request)) {
			sendDiagnosticsUnauthorized(response);
			return;
		}
		if (pathname.endsWith("/clear")) {
			if (request.method !== "POST") {
				response.writeHead(405, { "Allow": "POST", "Cache-Control": "no-store" });
				response.end("Method not allowed");
				return;
			}
			networkDiagnostics.length = 0;
			response.writeHead(200, {
				"Content-Type": "application/json; charset=utf-8",
				"Cache-Control": "no-store",
			});
			response.end(JSON.stringify({ cleared: true }));
			return;
		}
		if (request.method !== "GET") {
			response.writeHead(405, { "Allow": "GET", "Cache-Control": "no-store" });
			response.end("Method not allowed");
			return;
		}
		const requestedLimit = Number(new URL(request.url ?? "/", "http://localhost").searchParams.get("limit") ?? 100);
		const limit = Number.isFinite(requestedLimit)
			? Math.min(MAX_NETWORK_DIAGNOSTICS, Math.max(1, Math.trunc(requestedLimit)))
			: 100;
		response.writeHead(200, {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "no-store",
		});
		response.end(JSON.stringify({
			count: networkDiagnostics.length,
			events: networkDiagnostics.slice(-limit).reverse(),
		}));
		return;
	}

	if (request.method === "GET" && pathname === "/health") {
		setHealthCors(request, response, allowedOrigins);
		const playerDiagnostics = await inspectPlayerBuild();
		const ready = playerDiagnostics.playerReady;
		response.writeHead(ready ? 200 : 503, {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "no-store",
		});
		response.end(JSON.stringify({
			status: ready ? "ok" : "error",
			service: "cork7-wisp",
			player: "/c7/",
			playerReady: ready,
			playerDiagnostics,
			allowedHosts,
			websocketPath: WISP_PATH,
		}));
		return;
	}

	if (request.method === "GET" && (pathname === PLAYER_PATH || pathname === SALTYSEAS_PLAYER_PATH)) {
		const redirectPath = pathname === SALTYSEAS_PLAYER_PATH
			? SALTYSEAS_PLAYER_PATH + "/"
			: PLAYER_PATH + "/";
		response.writeHead(308, {
			Location: redirectPath,
			"Cache-Control": "no-store",
		});
		response.end();
		return;
	}

	const isSaltyseasPlayerPath =
		pathname === SALTYSEAS_PLAYER_PATH + "/" ||
		pathname.startsWith(SALTYSEAS_PLAYER_PATH + "/");
	const isCork7PlayerPath =
		pathname === PLAYER_PATH + "/" ||
		pathname.startsWith(PLAYER_PATH + "/");

	if (request.method === "GET" && (isCork7PlayerPath || isSaltyseasPlayerPath)) {
		const requestedSite = new URL(request.url ?? "/", "http://localhost").searchParams.get("site");
		const useSaltyseas = isSaltyseasPlayerPath || requestedSite === "saltyseas";
		const pageTargetUrl = useSaltyseas
			? parseTargetUrl(SALTYSEAS_TARGET_URL, allowedHosts)
			: targetUrl;
		const assetPath = isSaltyseasPlayerPath
			? PLAYER_PATH + pathname.slice(SALTYSEAS_PLAYER_PATH.length)
			: pathname;
		void servePlayerAsset(assetPath, request, response, pageTargetUrl);
		return;
	}

	response.writeHead(404, {
		"Content-Type": "text/plain; charset=utf-8",
		"Cache-Control": "no-store",
	});
	response.end("Not found");
});

server.on("upgrade", (request, socket, head) => {
	if (request.url !== WISP_PATH) {
		console.warn('Rejected WebSocket upgrade for unexpected path "' + request.url + '".');
		rejectUpgrade(socket, 404, "Not Found");
		return;
	}

	const originHeader = request.headers.origin;
	let origin = "";
	try {
		origin = typeof originHeader === "string" ? normalizeOrigin(originHeader) : "";
	} catch {
		origin = "";
	}

	if (!origin || !allowedOrigins.has(origin)) {
		console.warn('Rejected Wisp upgrade from unapproved origin "' + (originHeader ?? "(missing)") + '".');
		rejectUpgrade(socket, 403, "Forbidden");
		return;
	}

	if (activeWsConnections >= maxWsConnections) {
		rejectUpgrade(socket, 429, "Too Many Connections");
		return;
	}

	activeWsConnections += 1;
	console.info(
		"Accepted Wisp upgrade from " + origin +
		"; protocol=" + (request.headers["sec-websocket-protocol"] ?? "(none)") +
		"; active=" + activeWsConnections,
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
	console.log("Cork7 player and Wisp backend listening on " + HOST + ":" + port);
	console.log("Player path: " + PLAYER_PATH + "/");
	console.log("WebSocket endpoint: " + WISP_PATH);
	console.log("Allowed destinations: " + allowedHosts.join(", "));
	console.log("Allowed browser origins: " + [...allowedOrigins].join(", "));
});

function shutdown(signal) {
	console.log(signal + " received; shutting down Cork7 Wisp backend.");
	server.close(() => process.exit(0));
	const forceExit = setTimeout(() => process.exit(1), 10_000);
	forceExit.unref();
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
