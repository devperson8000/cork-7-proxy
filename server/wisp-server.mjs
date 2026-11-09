import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";

const HOST = "0.0.0.0";
const WISP_PATH = "/wisp/";
const PLAYER_PATH = "/c7";
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(SERVER_DIR, "..");
const STATIC_ROOT = path.join(APP_ROOT, "packages", "demo", "dist");
const PLAYER_INDEX = path.join(STATIC_ROOT, "index.html");

const DEFAULT_ALLOWED_HOSTS = "cork7.com,www.cork7.com,live.cork7.com";
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

async function servePlayerAsset(pathname, response) {
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
					targetUrl,
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

const allowedHosts = parseAllowedHosts(
	process.env.CORK7_ALLOWED_HOSTS ?? DEFAULT_ALLOWED_HOSTS,
);
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
	return originalCreateWispStream.apply(this, args);
};

// Keep Wisp restricted to the exact Cork7 hosts and standard web ports.
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
			websocketPath: WISP_PATH,
		}));
		return;
	}

	if (request.method === "GET" && pathname === PLAYER_PATH) {
		response.writeHead(308, {
			Location: PLAYER_PATH + "/",
			"Cache-Control": "no-store",
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
