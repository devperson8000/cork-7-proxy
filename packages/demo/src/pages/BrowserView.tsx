import { css, type Component } from "dreamland/core";
import { controllerReady } from "..";
import type { Frame } from "@mercuryworkshop/scramjet-controller";

const CORK7_HOME = "https://cork7.com/";
const ALLOWED_GAME_HOSTS = new Set([
	"cork7.com",
	"www.cork7.com",
	"live.cork7.com",
]);

function getSafeInitialUrl(): string {
	const requested = new URL(location.href).searchParams.get("goto");
	if (!requested) return CORK7_HOME;

	try {
		const candidate = new URL(requested);
		if (
			candidate.protocol === "https:" &&
			ALLOWED_GAME_HOSTS.has(candidate.hostname)
		) {
			return candidate.href;
		}
	} catch {
		// Invalid URL falls back to the official game home.
	}

	return CORK7_HOME;
}

const BrowserView: Component<
	{},
	{},
	{
		frameel: HTMLIFrameElement;
	}
> = function (cx) {
	cx.mount = async () => {
		const diagnostics = (window as any).C7Diagnostics;
		diagnostics?.set("game", "pending", "Waiting for Scramjet controller before creating game frame");
		try {
			const controller = await controllerReady;
			diagnostics?.set("game", "pending", "Controller ready; creating Cork7 frame");
			const frame: Frame = controller.createFrame(this.frameel);
			const target = getSafeInitialUrl();

			const status = document.getElementById("game-status");
			if (status) status.textContent = "CONNECTING TO CORK7";
			const navigate = () => {
				diagnostics?.set("game", "pending", "Navigating to the fixed official Cork7 homepage");
				diagnostics?.log("Starting game frame navigation to " + target);
				this.frameel.addEventListener("load", () => {
					try {
						const bodyText = this.frameel.contentDocument?.body?.innerText || "";
						if (bodyText.includes("Internal Service Worker Error")) {
							diagnostics?.set("game", "error", bodyText.slice(0, 700));
						} else {
							diagnostics?.set("game", "ok", "Frame loaded · " + (this.frameel.contentWindow?.location.pathname || "path unavailable"));
						}
					} catch {
						diagnostics?.set("game", "warn", "Frame emitted a load event; its document could not be inspected");
					}
				}, { once: true });
				frame.go(target);
			};
			this.frameel.addEventListener("load", navigate, { once: true });
			this.frameel.src = "about:blank";
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			diagnostics?.set("game", "error", message);
			diagnostics?.log("Game frame initialization failed: " + message);
			console.error("Could not start the Cork7 frame:", error);
			const status = document.getElementById("game-status");
			if (status) status.textContent = "PLAYER INIT FAILED";
		}
	};

	return (
		<div class="game-frame">
			<iframe
				this={use(this.frameel)}
				title="Cork7 game"
				allow="autoplay; fullscreen; gamepad"
				allowfullscreen
				referrerpolicy="no-referrer"
			></iframe>
		</div>
	);
};

BrowserView.style = css`
	:scope {
		flex: 1;
		min-width: 0;
		min-height: 0;
		display: flex;
		background: #080b10;
	}
	iframe {
		width: 100%;
		height: 100%;
		border: 0;
		background: #080b10;
	}
`;

export default BrowserView;
