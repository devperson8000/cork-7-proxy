import { css, type Component } from "dreamland/core";
import BrowserView from "./pages/BrowserView";

function getSiteMode(): "alpine" | "pirate" | "chess" {
	const runtimeConfig = (window as typeof window & {
		CORK7_CONFIG?: { site?: unknown; targetUrl?: unknown };
	}).CORK7_CONFIG;
	try {
		if (runtimeConfig?.site === "saltyseas") return "pirate";
		if (runtimeConfig?.site === "chess") return "chess";
		if (runtimeConfig?.site === "cork7") return "alpine";
		if (typeof runtimeConfig?.targetUrl === "string") {
			const hostname = new URL(runtimeConfig.targetUrl).hostname.toLowerCase();
			return hostname === "saltyseas.io"
				? "pirate"
				: hostname === "www.chess.com"
					? "chess"
					: "alpine";
		}
	} catch {
		// BrowserView handles invalid target configuration safely.
	}
	return "alpine";
}

const App: Component = function () {
	const siteMode = getSiteMode();
	const isPirate = siteMode === "pirate";
	const isChess = siteMode === "chess";
	const isEmbedded = window.self !== window.top;
	document.title = isPirate ? "Saltyseas | Pirate Waters" : isChess ? "Chess.com | Player" : "Cork7 | Alpine Run";

	return (
		<main class={"player-shell " + (isPirate ? "theme-pirate" : isChess ? "theme-chess" : "theme-alpine") + (isEmbedded ? " is-embedded" : "")}>
			{!isEmbedded ? (
				<header class="topbar">
					<div class="brand">
						<div class="brand-mark" aria-hidden="true">{isPirate ? "☠" : isChess ? "♞" : "C7"}</div>
						<div class="brand-copy">
							<div class="brand-title">{isPirate ? "SALTYSEAS" : isChess ? "CHESS.COM" : "CORK7"}</div>
							<div class="brand-subtitle">{isPirate ? "PIRATE WATERS · PLAYER" : isChess ? "ONLINE CHESS · PLAYER" : "ALPINE RUN · PLAYER"}</div>
						</div>
					</div>
					<div class="topbar-note">{isPirate ? "OPEN WATERS SESSION" : isChess ? "CHESS SESSION" : "MOUNTAIN SESSION"}</div>
				</header>
			) : null}
			<section class="player-content" aria-label={isPirate ? "Saltyseas player" : isChess ? "Chess.com player" : "Cork7 player"}>
				<BrowserView />
			</section>
		</main>
	);
};

App.style = css`
	:scope {
		--accent: #a9e7f7;
		--accent-soft: rgba(100, 196, 224, .18);
		--line: rgba(168, 218, 232, .15);
		position: fixed;
		inset: 0;
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100vh;
		height: 100dvh;
		min-height: 0;
		overflow: hidden;
		box-sizing: border-box;
		background: radial-gradient(900px 420px at 50% -260px, rgba(66, 145, 183, .22), transparent 72%), #07111b;
		color: #edf5fa;
		font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	}
	:scope.theme-chess {
		--accent: #b5e6bd;
		--accent-soft: rgba(126, 196, 139, .17);
		--line: rgba(181, 230, 189, .17);
		background: radial-gradient(900px 420px at 50% -260px, rgba(69, 143, 91, .24), transparent 72%), #091a14;
	}
	:scope.theme-pirate {
		--accent: #f1c77b;
		--accent-soft: rgba(241, 199, 123, .16);
		--line: rgba(241, 199, 123, .17);
		background: radial-gradient(900px 420px at 50% -260px, rgba(29, 112, 125, .28), transparent 72%), #07151b;
	}
	.topbar {
		position: relative;
		z-index: 2;
		display: flex;
		flex: 0 0 62px;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 0 clamp(16px, 2.2vw, 30px);
		border-bottom: 1px solid var(--line);
		background: rgba(7, 15, 23, .94);
	}
	.theme-pirate .topbar { background: rgba(6, 20, 25, .94); }
	.brand { display: flex; align-items: center; gap: 11px; min-width: 0; }
	.brand-mark {
		display: grid;
		width: 36px;
		height: 36px;
		flex: 0 0 36px;
		place-items: center;
		border: 1px solid color-mix(in srgb, var(--accent) 50%, transparent);
		border-radius: 11px;
		background: linear-gradient(145deg, var(--accent-soft), rgba(27, 47, 57, .38));
		color: var(--accent);
		font-size: 14px;
		font-weight: 900;
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, .06), 0 4px 16px rgba(0, 0, 0, .18);
	}
	.brand-copy { min-width: 0; }
	.brand-title { color: #f2f6f8; font-size: 12px; font-weight: 900; letter-spacing: .2em; line-height: 1.1; }
	.brand-subtitle { margin-top: 4px; color: #91a7b5; font-size: 8px; font-weight: 750; letter-spacing: .16em; line-height: 1; }
	.topbar-note { color: var(--accent); font-size: 9px; font-weight: 800; letter-spacing: .16em; white-space: nowrap; }
	.player-content { display: flex; flex: 1 1 auto; min-width: 0; min-height: 0; padding: 12px clamp(12px, 1.8vw, 24px) 14px; }
	:scope.is-embedded .player-content { padding: 0; }
	@media (max-width: 600px) {
		.topbar { flex-basis: 56px; padding: 0 14px; }
		.brand-mark { width: 32px; height: 32px; flex-basis: 32px; border-radius: 9px; }
		.topbar-note { font-size: 8px; letter-spacing: .1em; }
		.player-content { padding: 8px; }
	}
	@media (prefers-reduced-motion: reduce) {
		:scope *, :scope *::before, :scope *::after {
			scroll-behavior: auto !important;
			animation-duration: .01ms !important;
			animation-iteration-count: 1 !important;
			transition-duration: .01ms !important;
		}
	}
`;

export default App;
