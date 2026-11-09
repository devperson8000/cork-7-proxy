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
		try {
			const controller = await controllerReady;
			const frame: Frame = controller.createFrame(this.frameel);
			const target = getSafeInitialUrl();

			const status = document.getElementById("game-status");
			if (status) status.textContent = "CONNECTING TO CORK7";
			const navigate = () => frame.go(target);
			this.frameel.addEventListener("load", navigate, { once: true });
			this.frameel.src = "about:blank";
		} catch (error) {
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
