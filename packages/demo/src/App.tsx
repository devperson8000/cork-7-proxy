import { css, type Component } from "dreamland/core";
import BrowserView from "./pages/BrowserView";
import { demoSettingsStore } from "./store";
import { client as WispClient } from "@mercuryworkshop/wisp-js/client";

const HEALTH_URL = "https://p01--cork7--yf5q7tyyggsr.code.run/health";

function setStatus(id: string, value: string, state: string) {
	const element = document.getElementById(id);
	if (!element) return;
	element.textContent = value;
	element.setAttribute("data-state", state);
}

async function checkBackend() {
	try {
		const response = await fetch(HEALTH_URL, {
			cache: "no-store",
			mode: "cors",
		});
		if (!response.ok) throw new Error(`Health check returned ${response.status}`);
		const body = await response.json();
		if (body.status !== "ok") throw new Error("Unexpected health response");
		setStatus("backend-status", "ONLINE", "ok");
	} catch (error) {
		console.warn("Cork7 backend health check failed:", error);
		setStatus("backend-status", "CHECK CONNECTION", "error");
	}
}

function checkWebSocket() {
	setStatus("ws-status", "CONNECTING", "pending");
	let connection: ClientConnection;
	try {
		// Use the real Wisp client so the v2 subprotocol and INFO/CONTINUE
		// handshake are tested, rather than only testing a bare WebSocket.
		connection = new WispClient.ClientConnection(demoSettingsStore.wispUrl);
	} catch (error) {
		console.warn("Cork7 Wisp connection could not be created:", error);
		setStatus("ws-status", "UNAVAILABLE", "error");
		return;
	}

	let settled = false;
	const timeout = window.setTimeout(() => {
		if (settled) return;
		settled = true;
		setStatus("ws-status", "TIMEOUT", "error");
		connection.close();
	}, 8000);

	connection.onopen = () => {
		if (settled) return;
		settled = true;
		window.clearTimeout(timeout);
		setStatus("ws-status", "CONNECTED", "ok");
		connection.close();
	};

	connection.onerror = () => {
		if (settled) return;
		settled = true;
		window.clearTimeout(timeout);
		setStatus("ws-status", "HANDSHAKE FAILED", "error");
	};

	connection.onclose = () => {
		if (settled) return;
		settled = true;
		window.clearTimeout(timeout);
		setStatus("ws-status", "CONNECTION CLOSED", "error");
	};
}

const App: Component = function (cx) {
	cx.mount = () => {
		void checkBackend();
		checkWebSocket();
	};

	return (
		<main class="player-shell">
			<header class="topbar">
				<div class="brand">
					<span class="brand-mark">C7</span>
					<div>
						<div class="brand-title">CORK7</div>
						<div class="brand-subtitle">DEDICATED GAME SESSION</div>
					</div>
				</div>
				<div class="connection-status">
					<div class="status-item">
						<span class="status-label">BACKEND</span>
						<strong id="backend-status" data-state="pending">CHECKING</strong>
					</div>
					<div class="status-item">
						<span class="status-label">WSS</span>
						<strong id="ws-status" data-state="pending">CHECKING</strong>
					</div>
				</div>
			</header>
			<section class="player-content">
				<div class="game-label">
					<span>GAME</span>
					<strong id="game-status">LOADING CORK7</strong>
					<a href="https://cork7.com/" target="_blank" rel="noopener noreferrer">OPEN OFFICIAL GAME</a>
				</div>
				<BrowserView />
			</section>
			<footer class="footer">
				<span>ONE GAME · FIXED DESTINATION</span>
				<span>CONNECTION STATUS IS SHOWN ABOVE</span>
			</footer>
		</main>
	);
};

App.style = css`
	:scope {
		position: fixed;
		inset: 0;
		width: 100%;
		height: 100%;
		min-height: 100vh;
		box-sizing: border-box;
		background: #080b10;
		color: #edf2f7;
		font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
		display: flex;
		flex-direction: column;
	}
	.topbar {
		min-height: 66px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 18px;
		padding: 0 22px;
		border-bottom: 1px solid #202a36;
		background: #0d131c;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.brand-mark {
		width: 38px;
		height: 38px;
		display: grid;
		place-items: center;
		border: 1px solid #7db8ae;
		border-radius: 9px;
		color: #a8e3d6;
		font-weight: 800;
		letter-spacing: -1px;
	}
	.brand-title {
		font-size: 13px;
		font-weight: 800;
		letter-spacing: .18em;
	}
	.brand-subtitle, .status-label, .game-label > span, .footer {
		color: #8292a5;
		font-size: 9px;
		font-weight: 700;
		letter-spacing: .14em;
	}
	.brand-subtitle { margin-top: 3px; }
	.connection-status {
		display: flex;
		align-items: center;
		gap: 20px;
	}
	.status-item {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 96px;
	}
	.status-item strong {
		font-size: 10px;
		letter-spacing: .1em;
		color: #d3dbe5;
	}
	.status-item strong[data-state="ok"] { color: #83d8a4; }
	.status-item strong[data-state="error"] { color: #f0a0a0; }
	.player-content {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		padding: 12px 16px 10px;
		gap: 10px;
	}
	.game-label {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 10px;
	}
	.game-label strong {
		font-size: 10px;
		letter-spacing: .08em;
		color: #e5edf5;
	}
	.game-label a {
		margin-left: auto;
		color: #91cfc2;
		text-decoration: none;
		font-size: 10px;
	}
	.game-label a:hover { text-decoration: underline; }
	.game-frame {
		flex: 1;
		min-height: 0;
		border: 1px solid #263342;
		border-radius: 10px;
		overflow: hidden;
		background: #05080c;
	}
	.footer {
		min-height: 28px;
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0 22px;
		border-top: 1px solid #18222d;
	}
	@media (max-width: 600px) {
		.topbar { padding: 0 12px; min-height: 60px; }
		.connection-status { gap: 10px; }
		.status-item { min-width: 70px; }
		.player-content { padding: 8px; }
		.footer { padding: 0 10px; font-size: 8px; letter-spacing: .08em; }
	}
`;

export default App;
