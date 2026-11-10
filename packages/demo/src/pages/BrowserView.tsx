import { css, type Component } from "dreamland/core";
import { controllerReady } from "..";
import type { Frame } from "@mercuryworkshop/scramjet-controller";

const DEFAULT_CORK7_HOME = "https://cork7.com/";
const DEFAULT_ALLOWED_GAME_HOSTS = new Set([
	"cork7.com",
	"www.cork7.com",
	"live.cork7.com",
]);

function getSafeInitialUrl(): string {
	const runtimeConfig = (window as typeof window & {
		CORK7_CONFIG?: { targetUrl?: unknown; allowedHosts?: unknown };
	}).CORK7_CONFIG;
	const configuredUrl =
		typeof runtimeConfig?.targetUrl === "string"
			? runtimeConfig.targetUrl
			: DEFAULT_CORK7_HOME;
	const allowedHosts = new Set(
		Array.isArray(runtimeConfig?.allowedHosts)
			? runtimeConfig.allowedHosts.filter((host): host is string => typeof host === "string")
			: [...DEFAULT_ALLOWED_GAME_HOSTS],
	);

	try {
		const target = new URL(configuredUrl);
		if (
			target.protocol === "https:" &&
			!target.username &&
			!target.password &&
			(target.port === "" || target.port === "443") &&
			allowedHosts.has(target.hostname.toLowerCase())
		) {
			return target.href;
		}
	} catch {
		// Invalid runtime configuration falls back to the default Cork7 home.
	}

	console.error("CORK7_TARGET_URL is invalid or its host is not allowlisted; using the default Cork7 homepage.");
	return DEFAULT_CORK7_HOME;
}

type NetworkDiagnosticEntry = {
	time: string;
	host: string;
	method: string;
	status: number;
	errorType: string | null;
};

type WebkitFullscreenDocument = Document & {
	webkitFullscreenElement?: Element | null;
	webkitExitFullscreen?: () => Promise<void> | void;
};

type WebkitFullscreenElement = HTMLElement & {
	webkitRequestFullscreen?: () => Promise<void> | void;
};

const BrowserView: Component<
	{},
	{},
	{
		frameel: HTMLIFrameElement;
	}
> = function (cx) {
	cx.mount = async () => {
		const gameRoot = this.frameel.parentElement;
		const loadingTitle = gameRoot?.querySelector<HTMLElement>(".loading-title");
		const loadingDetail = gameRoot?.querySelector<HTMLElement>(".loading-detail");
		const fullscreenButton = gameRoot?.querySelector<HTMLButtonElement>(".fullscreen-toggle");
		const fullscreenDocument = document as WebkitFullscreenDocument;

		const diagnosticsPanel = gameRoot?.querySelector<HTMLDetailsElement>(".network-diagnostics-panel");
		const diagnosticsOutput = gameRoot?.querySelector<HTMLElement>(".network-diagnostics-output");
		const diagnosticsCopy = gameRoot?.querySelector<HTMLButtonElement>(".network-diagnostics-copy");
		const networkEntries: NetworkDiagnosticEntry[] = [];

		const renderNetworkDiagnostics = () => {
			if (!diagnosticsOutput) return;
			diagnosticsOutput.textContent = networkEntries.length
				? networkEntries.map((entry) => {
					const time = new Date(entry.time).toLocaleTimeString();
					const result = entry.errorType
						? `NETWORK ERROR (${entry.errorType})`
						: `HTTP ${entry.status}`;
					return `[${time}] ${entry.method} https://${entry.host} — ${result}`;
				}).join("\\n")
				: "No Fetch/XHR requests captured yet. Open the account form and try again.";
		};

		const onNetworkDiagnostic = (event: MessageEvent) => {
			const message = event.data;
			if (message?.type !== "C7_API_NETWORK_DIAGNOSTIC") return;
			const entry = message.entry as Partial<NetworkDiagnosticEntry> | undefined;
			if (
				!entry ||
				typeof entry.time !== "string" ||
				typeof entry.host !== "string" ||
				typeof entry.method !== "string" ||
				typeof entry.status !== "number"
			) return;

			networkEntries.push({
				time: entry.time,
				host: entry.host,
				method: entry.method,
				status: entry.status,
				errorType: typeof entry.errorType === "string" ? entry.errorType : null,
			});
			if (networkEntries.length > 30) networkEntries.shift();
			if (entry.status >= 400 || entry.errorType) {
				if (diagnosticsPanel) diagnosticsPanel.open = true;
			}
			renderNetworkDiagnostics();
		};

		navigator.serviceWorker?.addEventListener("message", onNetworkDiagnostic);
		diagnosticsCopy?.addEventListener("click", async () => {
			try {
				await navigator.clipboard.writeText(diagnosticsOutput?.textContent ?? "");
				diagnosticsCopy.textContent = "Copied";
			} catch {
				diagnosticsCopy.textContent = "Copy unavailable";
			}
		});
		renderNetworkDiagnostics();

		const updateFullscreenButton = () => {
			const active =
				document.fullscreenElement === gameRoot ||
				fullscreenDocument.webkitFullscreenElement === gameRoot;
			fullscreenButton?.classList.toggle("is-active", active);
			fullscreenButton?.setAttribute("aria-label", active ? "Exit fullscreen" : "Enter fullscreen");
			if (fullscreenButton) {
				fullscreenButton.title = active ? "Exit fullscreen (Esc)" : "Enter fullscreen";
			}
			const label = fullscreenButton?.querySelector<HTMLElement>(".fullscreen-label");
			if (label) label.textContent = active ? "Exit fullscreen" : "Fullscreen";
		};

		const toggleFullscreen = async () => {
			if (!gameRoot) return;
			const active =
				document.fullscreenElement === gameRoot ||
				fullscreenDocument.webkitFullscreenElement === gameRoot;
			const webkitRoot = gameRoot as WebkitFullscreenElement;

			try {
				if (active) {
					if (document.exitFullscreen) {
						await document.exitFullscreen();
					} else {
						await fullscreenDocument.webkitExitFullscreen?.();
					}
				} else if (gameRoot.requestFullscreen) {
					await gameRoot.requestFullscreen();
				} else if (webkitRoot.webkitRequestFullscreen) {
					await webkitRoot.webkitRequestFullscreen();
				} else if (fullscreenButton) {
					fullscreenButton.disabled = true;
					fullscreenButton.title = "Fullscreen is not supported by this browser";
				}
			} catch (error) {
				console.warn("Cork7 fullscreen mode could not be changed:", error);
			}
		};

		fullscreenButton?.addEventListener("click", toggleFullscreen);
		document.addEventListener("fullscreenchange", updateFullscreenButton);
		document.addEventListener("webkitfullscreenchange", updateFullscreenButton);
		updateFullscreenButton();

		const showStartupError = (error: unknown) => {
			const detail = error instanceof Error ? error.message : String(error);
			gameRoot?.classList.add("is-error");
			if (loadingTitle) loadingTitle.textContent = "PLAYER UNAVAILABLE";
			if (loadingDetail) loadingDetail.textContent = detail
				? "Refresh the page to reconnect to Cork7."
				: "The player could not start. Refresh to try again.";
		};

		try {
			const controller = await controllerReady;
			const frame: Frame = controller.createFrame(this.frameel);

			const navigate = () => {
				this.frameel.addEventListener("load", () => {
					gameRoot?.classList.add("is-loaded");
				}, { once: true });

				try {
					const targetUrl = getSafeInitialUrl();
					const navigation = frame.go(targetUrl);
					Promise.resolve(navigation).catch((error) => {
						console.error("Could not open the Cork7 game frame:", error);
						showStartupError(error);
					});
				} catch (error) {
					console.error("Could not open the Cork7 game frame:", error);
					showStartupError(error);
				}
			};

			this.frameel.addEventListener("load", navigate, { once: true });
			this.frameel.src = "about:blank";
		} catch (error) {
			console.error("Cork7 player initialization failed:", error);
			showStartupError(error);
		}
	};

	return (
		<div class="game-frame">
			<div class="game-loading" role="status" aria-live="polite">
				<div class="loading-mark">C7</div>
				<div class="loading-spinner" aria-hidden="true"></div>
				<div class="loading-title">CONNECTING TO CORK7</div>
				<div class="loading-detail">Preparing your game session</div>
			</div>
			<iframe
				this={use(this.frameel)}
				title="Cork7 game"
				allow="autoplay; fullscreen; gamepad"
				allowfullscreen
				referrerpolicy="no-referrer"
			></iframe>
			<details class="network-diagnostics-panel">
				<summary>
					<span>Network diagnostics</span>
					<span class="network-diagnostics-hint">Fetch / XHR</span>
				</summary>
				<div class="network-diagnostics-body">
					<p>Shows request hostnames and HTTP status only. Login details, cookies, headers and request contents are not collected.</p>
					<pre class="network-diagnostics-output">No Fetch/XHR requests captured yet. Open the account form and try again.</pre>
					<button class="network-diagnostics-copy" type="button">Copy report</button>
				</div>
			</details>
			<button class="fullscreen-toggle" type="button" aria-label="Enter fullscreen" title="Enter fullscreen">
				<svg class="fullscreen-enter-icon" viewBox="0 0 20 20" aria-hidden="true">
					<path d="M7 3H3v4M13 3h4v4M3 13v4h4M17 13v4h-4" />
				</svg>
				<svg class="fullscreen-exit-icon" viewBox="0 0 20 20" aria-hidden="true">
					<path d="M7 3v4H3M13 3v4h4M3 13h4v4M17 13h-4v4" />
				</svg>
				<span class="fullscreen-label">Fullscreen</span>
			</button>
		</div>
	);
};

BrowserView.style = css`
	:scope {
		display: flex;
		flex: 1 1 auto;
		min-width: 0;
		min-height: 0;
	}
	.game-frame {
		position: relative;
		isolation: isolate;
		contain: layout paint;
		flex: 1 1 auto;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
		border: 1px solid rgba(123, 151, 172, .2);
		border-radius: 13px;
		background: #030609;
		box-shadow: 0 16px 48px rgba(0, 0, 0, .24), inset 0 1px 0 rgba(255, 255, 255, .025);
	}
	.game-frame:fullscreen,
	.game-frame:-webkit-full-screen {
		width: 100vw;
		height: 100vh;
		min-width: 100vw;
		min-height: 100vh;
		max-width: none;
		max-height: none;
		margin: 0;
		border: 0;
		border-radius: 0;
		background: #000;
		box-shadow: none;
	}
	iframe {
		position: absolute;
		inset: 0;
		display: block;
		width: 100%;
		height: 100%;
		border: 0;
		background: #000;
	}
	.game-loading {
		position: absolute;
		z-index: 2;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 11px;
		background:
			radial-gradient(ellipse at 50% 42%, rgba(39, 79, 82, .2), transparent 42%),
			#080d13;
		color: #eff5f6;
		opacity: 1;
		visibility: visible;
		transition: opacity .22s ease, visibility .22s ease;
		pointer-events: none;
	}
	.game-frame.is-loaded .game-loading { opacity: 0; visibility: hidden; }
	.game-frame.is-error .game-loading { opacity: 1; visibility: visible; }
	.loading-mark {
		display: grid;
		width: 42px;
		height: 42px;
		place-items: center;
		border: 1px solid rgba(151, 215, 203, .42);
		border-radius: 12px;
		background: rgba(91, 151, 143, .1);
		color: #b6e7dc;
		font-size: 15px;
		font-weight: 850;
		letter-spacing: -.08em;
	}
	.loading-spinner {
		width: 18px;
		height: 18px;
		border: 2px solid rgba(151, 190, 193, .2);
		border-top-color: #9bd6ca;
		border-radius: 50%;
		animation: cork7-spin .8s linear infinite;
	}
	.game-frame.is-error .loading-spinner { display: none; }
	.loading-title {
		margin-top: 3px;
		color: #dce9eb;
		font-size: 10px;
		font-weight: 800;
		letter-spacing: .18em;
	}
	.loading-detail {
		color: #788d9b;
		font-size: 11px;
		letter-spacing: .02em;
	}
	.network-diagnostics-panel {
		position: absolute;
		z-index: 6;
		left: 14px;
		bottom: 14px;
		width: min(560px, calc(100% - 28px));
		max-height: min(42vh, 300px);
		overflow: hidden;
		border: 1px solid rgba(145, 174, 187, .26);
		border-radius: 10px;
		background: rgba(5, 10, 16, .94);
		color: #dce9eb;
		box-shadow: 0 10px 32px rgba(0, 0, 0, .34);
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
		font-size: 11px;
	}
	.network-diagnostics-panel summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 12px;
		color: #cde5e3;
		font-weight: 800;
		letter-spacing: .08em;
		text-transform: uppercase;
		cursor: pointer;
		user-select: none;
	}
	.network-diagnostics-hint {
		color: #7895a2;
		font-size: 9px;
		letter-spacing: .08em;
	}
	.network-diagnostics-body {
		padding: 0 10px 10px;
	}
	.network-diagnostics-body p {
		margin: 0 0 8px;
		color: #8499a5;
		font-size: 10px;
		line-height: 1.45;
	}
	.network-diagnostics-output {
		max-height: 190px;
		margin: 0;
		overflow: auto;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		color: #b4c8d0;
		font: 10px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
	}
	.network-diagnostics-copy {
		margin-top: 9px;
		padding: 6px 9px;
		border: 1px solid rgba(145, 174, 187, .24);
		border-radius: 7px;
		background: rgba(43, 64, 74, .4);
		color: #dce9eb;
		font: inherit;
		font-size: 10px;
		cursor: pointer;
	}
	.network-diagnostics-copy:hover { background: rgba(70, 105, 112, .48); }
	@media (max-width: 600px) {
		.network-diagnostics-panel { left: 8px; bottom: 8px; width: calc(100% - 16px); }
	}
	.fullscreen-toggle {
		position: absolute;
		z-index: 5;
		top: 14px;
		right: 14px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		min-height: 36px;
		padding: 0 12px;
		border: 1px solid rgba(196, 220, 225, .2);
		border-radius: 9px;
		background: rgba(7, 13, 20, .78);
		color: #e7f0f1;
		font: inherit;
		font-size: 10px;
		font-weight: 750;
		letter-spacing: .08em;
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		cursor: pointer;
		transition: background .16s ease, border-color .16s ease, opacity .16s ease;
	}
	.fullscreen-toggle:hover,
	.fullscreen-toggle:focus-visible {
		border-color: rgba(157, 220, 208, .55);
		background: rgba(16, 31, 39, .94);
		outline: none;
	}
	.fullscreen-toggle svg {
		width: 15px;
		height: 15px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.7;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.fullscreen-exit-icon { display: none; }
	.fullscreen-toggle.is-active .fullscreen-enter-icon { display: none; }
	.fullscreen-toggle.is-active .fullscreen-exit-icon { display: block; }
	.game-frame:fullscreen .fullscreen-toggle,
	.game-frame:-webkit-full-screen .fullscreen-toggle {
		opacity: .2;
	}
	.game-frame:fullscreen .fullscreen-toggle:hover,
	.game-frame:fullscreen .fullscreen-toggle:focus-visible,
	.game-frame:-webkit-full-screen .fullscreen-toggle:hover,
	.game-frame:-webkit-full-screen .fullscreen-toggle:focus-visible {
		opacity: 1;
	}
	@keyframes cork7-spin { to { transform: rotate(360deg); } }
	@media (max-width: 600px) {
		.game-frame { border-radius: 9px; }
		.fullscreen-toggle { top: 9px; right: 9px; min-height: 34px; padding: 0 10px; }
	}
	@media (prefers-reduced-motion: reduce) {
		.loading-spinner { animation-duration: 1.6s; }
		.game-loading, .fullscreen-toggle { transition: none; }
	}
`;

export default BrowserView;
