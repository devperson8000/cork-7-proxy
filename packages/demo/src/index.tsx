import App from "./App";
import LibcurlClient from "@mercuryworkshop/libcurl-transport";
import EpoxyTransport from "@mercuryworkshop/epoxy-transport";
import { defaultConfig } from "@mercuryworkshop/scramjet";
import { Controller } from "@mercuryworkshop/scramjet-controller";
import { demoSettingsStore } from "./store";

const app = document.getElementById("app");
if (!app) {
	throw new Error("Cork7 player root element was not found.");
}

let controller: InstanceType<typeof Controller>;

// Epoxy is the default TLS transport. Keep Libcurl available as an explicit
// diagnostic fallback via ?transport=libcurl so the two TLS implementations
// can be compared against the same Wisp backend.
const transportOverride = new URLSearchParams(window.location.search).get("transport");
const selectedTransport = transportOverride === "libcurl" ? "libcurl" : "epoxy";

function createProxyTransport() {
	if (selectedTransport === "libcurl") {
		return new LibcurlClient({ wisp: demoSettingsStore.wispUrl });
	}
	return new EpoxyTransport({ wisp: demoSettingsStore.wispUrl });
}

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

async function waitForActiveWorker(
	registration: ServiceWorkerRegistration,
): Promise<ServiceWorker> {
	const activeWorker = registration.active;
	if (activeWorker?.state === "activated") return activeWorker;

	const candidate =
		registration.installing ??
		registration.waiting ??
		activeWorker;

	if (!candidate) {
		throw new Error("Service worker registration has no installing, waiting, or active worker.");
	}

	return withTimeout(
		new Promise<ServiceWorker>((resolve, reject) => {
			const checkState = () => {
				if (candidate.state === "activated") {
					candidate.removeEventListener("statechange", checkState);
					resolve(candidate);
				} else if (candidate.state === "redundant") {
					candidate.removeEventListener("statechange", checkState);
					reject(new Error("The service worker became redundant before activation."));
				}
			};
			candidate.addEventListener("statechange", checkState);
			checkState();
		}),
		15000,
		"Service worker activation",
	);
}

async function init(): Promise<InstanceType<typeof Controller>> {
	console.info("Cork7 network transport:", selectedTransport);
	if (!("serviceWorker" in navigator)) {
		throw new Error("This browser does not support service workers.");
	}

	const registration = await withTimeout(
		navigator.serviceWorker.register("/c7/sw.js", {
			scope: "/c7/",
			updateViaCache: "none",
		}),
		20000,
		"Service worker registration",
	);

	// Wait for this registration, not navigator.serviceWorker.ready.
	// The visible /c7 URL is intentionally outside the narrower /c7/ scope.
	const serviceWorker = await waitForActiveWorker(registration);

	controller = new Controller({
		serviceworker: serviceWorker,
		transport: createProxyTransport(),
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
