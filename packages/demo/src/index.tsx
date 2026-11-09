import LoadInterstitial from "./components/LoadInterstitial";
import App from "./App";
import LibcurlClient from "@mercuryworkshop/libcurl-transport";
import EpoxyClient from "@mercuryworkshop/epoxy-transport";
import { defaultConfig } from "@mercuryworkshop/scramjet";
import { Controller } from "@mercuryworkshop/scramjet-controller";
import { HttpCachePlugin } from "@mercuryworkshop/scramjet-utils";
import { demoSettingsStore } from "./store";

let app = document.getElementById("app")!;

let controller: InstanceType<typeof Controller>;
const cachePlugin = new HttpCachePlugin();

export function getTransport(): LibcurlClient | EpoxyClient {
	const wispUrl = demoSettingsStore.wispUrl;
	switch (demoSettingsStore.transport) {
		case "epoxy":
			return new EpoxyClient({ wisp: wispUrl });
		case "libcurl":
		default:
			return new LibcurlClient({ wisp: wispUrl });
	}
}

async function waitForControllerOrReady(timeoutMs = 10000): Promise<void> {
	if (navigator.serviceWorker.controller) return;

	const ready = navigator.serviceWorker.ready.then(() => {});
	const controllerChanged = new Promise<void>((resolve) => {
		const onChange = () => {
			navigator.serviceWorker.removeEventListener("controllerchange", onChange);
			resolve();
		};
		navigator.serviceWorker.addEventListener("controllerchange", onChange, {
			once: true,
		} as any);
	});
	const timeout = new Promise<void>((resolve) =>
		setTimeout(resolve, timeoutMs)
	);

	await Promise.race([ready, controllerChanged, timeout]);
}

async function init() {
	const interstitial: any = (
		<LoadInterstitial status={"Starting Cork7"}></LoadInterstitial>
	);
	document.body.append(interstitial);
	interstitial.showModal();

	try {
		const registration = await navigator.serviceWorker.register("./sw.js", {
			scope: "/c7/",
			updateViaCache: "none",
		});

		const updateStatus = (sw: ServiceWorker | null) => {
			if (!sw) return;
			const set = (message: string) => (interstitial.$.state.status = message);
			const apply = () => {
				switch (sw.state) {
					case "installing":
						set("Installing game service worker...");
						break;
					case "installed":
						set("Service worker installed...");
						break;
					case "activating":
						set("Activating game session...");
						break;
					case "activated":
						set("Game session ready...");
						break;
					case "redundant":
						set("Service worker replaced...");
						break;
				}
			};
			apply();
			sw.addEventListener("statechange", apply);
		};

		updateStatus(registration.installing ?? registration.waiting ?? null);
		interstitial.$.state.status = "Waiting for game session...";
		await waitForControllerOrReady(10000);
		interstitial.$.state.status = "Connecting game controller...";

		const readySw = navigator.serviceWorker.controller ?? registration.active;
		if (!readySw) {
			throw new Error("No active service worker is available.");
		}

		controller = new Controller({
			serviceworker: readySw,
			transport: getTransport(),
			config: {
				prefix: "/c7/~/sj/",
				scramjetPath: "/c7/scramjet/scramjet.js",
				injectPath: "/c7/controller/controller.inject.js",
				wasmPath: "/c7/scramjet/scramjet.wasm",
			},
			scramjetConfig: defaultConfig,
		});

		await controller.wait();
		interstitial.close();
	} catch (error) {
		console.error("Cork7 player initialization failed:", error);
		try {
			interstitial.close();
		} catch {}
		app.innerText =
			"Could not start the Cork7 player. Refresh the page or open the official game directly.";
		setTimeout(() => {
			const status = document.getElementById("game-status");
			if (status) status.textContent = "PLAYER INIT FAILED";
		}, 0);
	}
}

async function mount() {
	try {
		const root = <App />;
		app.replaceWith(root);
	} catch (error) {
		app.replaceWith(
			document.createTextNode(
				`Error mounting Cork7 player: ${error instanceof Error ? error.message : String(error)}`
			)
		);
		console.error(error);
		throw error;
	}
}

void init().then(() => mount());
export { controller, cachePlugin };
