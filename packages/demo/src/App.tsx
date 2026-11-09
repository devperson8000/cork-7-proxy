import { css, type Component } from "dreamland/core";
import BrowserView from "./pages/BrowserView";

const App: Component = function () {
	return (
		<main class="player-shell">
			<header class="topbar">
				<div class="brand">
					<div class="brand-mark" aria-hidden="true">C7</div>
					<div class="brand-copy">
						<div class="brand-title">CORK7</div>
						<div class="brand-subtitle">GAME PLAYER</div>
					</div>
				</div>
				<div class="topbar-note">OFFICIAL GAME SESSION</div>
			</header>
			<section class="player-content" aria-label="Cork7 game player">
				<BrowserView />
			</section>
		</main>
	);
};

App.style = css`
	:scope {
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
		background:
			radial-gradient(1000px 520px at 50% -280px, rgba(56, 112, 112, .18), transparent 70%),
			#080b10;
		color: #edf3f7;
		font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
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
		border-bottom: 1px solid rgba(126, 153, 174, .13);
		background: rgba(9, 14, 21, .94);
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 11px;
		min-width: 0;
	}
	.brand-mark {
		display: grid;
		width: 36px;
		height: 36px;
		flex: 0 0 36px;
		place-items: center;
		border: 1px solid rgba(151, 215, 203, .48);
		border-radius: 10px;
		background: linear-gradient(145deg, rgba(121, 191, 178, .16), rgba(27, 47, 57, .38));
		color: #b6e7dc;
		font-size: 14px;
		font-weight: 850;
		letter-spacing: -.08em;
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, .06), 0 4px 16px rgba(0, 0, 0, .18);
	}
	.brand-copy { min-width: 0; }
	.brand-title {
		color: #f2f6f8;
		font-size: 12px;
		font-weight: 850;
		letter-spacing: .2em;
		line-height: 1.1;
	}
	.brand-subtitle {
		margin-top: 4px;
		color: #8395a5;
		font-size: 8px;
		font-weight: 750;
		letter-spacing: .18em;
		line-height: 1;
	}
	.topbar-note {
		color: #637584;
		font-size: 9px;
		font-weight: 750;
		letter-spacing: .16em;
		white-space: nowrap;
	}
	.player-content {
		display: flex;
		flex: 1 1 auto;
		min-width: 0;
		min-height: 0;
		padding: 12px clamp(12px, 1.8vw, 24px) 14px;
	}
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
