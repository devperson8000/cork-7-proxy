import App from "./App";
import LibcurlClient from "@mercuryworkshop/libcurl-transport";
import EpoxyClient from "@mercuryworkshop/epoxy-transport";
import { defaultConfig } from "@mercuryworkshop/scramjet";
import { Controller } from "@mercuryworkshop/scramjet-controller";
import { HttpCachePlugin } from "@mercuryworkshop/scramjet-utils";
import { demoSettingsStore } from "./store";

let app = document.getElementById("app")!;

const diagnostics = (window as any).C7Diagnostics;
diagnostics?.set("moduleRuntime", "ok", "src/index.tsx module executed");
diagnostics?.log("Application module entrypoint executed.");

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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timeout = window.setTimeout(
			() => reject(new Error(`${label} timed out after ${timeoutMs / 1000}s`)),
			timeoutMs
		);
		promise.then(
			(value) => {
				window.clearTimeout(timeout);
				resolve(value);
			},
			(error) => {
				window.clearTimeout(timeout);
				reject(error);
			}
		);
	});
}

async function init(): Promise<InstanceType<typeof Controller>> {
	let serviceWorkerRegistered = false;
	try {
		diagnostics?.set("serviceWorker", "pending", "Registering /c7/sw.js with scope /c7/");
		const registration = await withTimeout(
			navigator.serviceWorker.register("./sw.js", {
				scope: "/c7/",
				updateViaCache: "none",
			}),
			20000,
			"Service worker registration"
		);
		serviceWorkerRegistered = true;
		diagnostics?.set(
			"serviceWorker",
			"ok",
			"Registered · scope " + registration.scope + " · active " + (registration.active?.state ?? "not active")
		);

		await waitForControllerOrReady(10000);

		const readySw = navigator.serviceWorker.controller ?? registration.active;
		diagnostics?.set(
			"swControl",
			navigator.serviceWorker.controller ? "ok" : "warn",
			navigator.serviceWorker.controller
				? "This page is controlled by the /c7/ service worker"
				: "No controller on this document yet; using active registration worker"
		);
		if (!readySw) {
			diagnostics?.set("swControl", "error", "Registration has no active service worker");
			throw new Error("No active service worker is available.");
		}

		diagnostics?.set("controller", "pending", "Creating Scramjet controller and loading WASM");
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

		await withTimeout(controller.wait(), 20000, "Scramjet controller startup");
		diagnostics?.set("controller", "ok", "Controller ready · WASM fetched · service-worker RPC responded");
		diagnostics?.log("Scramjet controller startup completed.");
		return controller;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (!serviceWorkerRegistered) {
			diagnostics?.set("serviceWorker", "error", message);
		}
		diagnostics?.set("controller", "error", message);
		diagnostics?.log("Controller initialization failed: " + message);
		console.error("Cork7 player initialization failed:", error);
		const status = document.getElementById("game-status");
		if (status) status.textContent = "PLAYER INIT FAILED";
		throw error;
	}
}

async function mount() {
	try {
		const root = <App />;
		diagnostics?.set("app", "ok", "Player interface component mounted");
		app.replaceWith(root);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		diagnostics?.set("app", "error", message);
		diagnostics?.log("Player interface mount failed: " + message);
		app.replaceWith(
			document.createTextNode(
				`Error mounting Cork7 player: ${error instanceof Error ? error.message : String(error)}`
			)
		);
		console.error(error);
		throw error;
	}
}

export const controllerReady = init();
void mount();
export { controller, cachePlugin };
