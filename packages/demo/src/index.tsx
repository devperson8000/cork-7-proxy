import App from "./App";
import EpoxyClient from "@mercuryworkshop/epoxy-transport";
import { defaultConfig } from "@mercuryworkshop/scramjet";
import { Controller } from "@mercuryworkshop/scramjet-controller";
import { demoSettingsStore } from "./store";

const app = document.getElementById("app");
if (!app) {
	throw new Error("Cork7 player root element was not found.");
}

let controller: InstanceType<typeof Controller>;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timeout = window.setTimeout(
			() => reject(new Error(label + " timed out after " + timeoutMs / 1000 + "s")),
			timeoutMs,
		);
		promise.then(
			(value) => {
				window.clearTimeout(timeout);
				resolve(value);
			},
			(error) => {
				window.clearTimeout(timeout);
				reject(error);
			},
		);
	});
}

async function init(): Promise<InstanceType<typeof Controller>> {
	const registration = await withTimeout(
		navigator.serviceWorker.register("/c7/sw.js", {
			scope: "/c7/",
			updateViaCache: "none",
		}),
		20000,
		"Service worker registration",
	);

	const activeRegistration = await withTimeout(
		navigator.serviceWorker.ready,
		15000,
		"Service worker activation",
	);
	const serviceWorker =
		navigator.serviceWorker.controller ??
		activeRegistration.active ??
		registration.active;

	if (!serviceWorker) {
		throw new Error("The Cork7 service worker did not become active.");
	}

	controller = new Controller({
		serviceworker: serviceWorker,
		transport: new EpoxyClient({ wisp: demoSettingsStore.wispUrl }),
		config: {
			prefix: "/c7/~/sj/",
			scramjetPath: "/c7/scramjet/scramjet.js",
			injectPath: "/c7/controller/controller.inject.js",
			wasmPath: "/c7/scramjet/scramjet.wasm",
		},
		scramjetConfig: defaultConfig,
	});

	await withTimeout(controller.wait(), 20000, "Scramjet controller startup");
	return controller;
}

async function mount() {
	try {
		const root = <App />;
		app.replaceWith(root);
	} catch (error) {
		console.error("Cork7 player interface could not be mounted:", error);
		app.innerHTML = "<main class='player-fatal'>Cork7 could not start. Refresh the page to try again.</main>";
	}
}

export const controllerReady = init();
void mount();
