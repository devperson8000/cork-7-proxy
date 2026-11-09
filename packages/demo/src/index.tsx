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

type DiagnosticStatus = "working" | "ok" | "warning" | "error";

type DiagnosticEntry = {
	time: string;
	stage: string;
	status: DiagnosticStatus;
	detail: string;
};

declare global {
	interface Window {
		__C7_DIAGNOSTICS__?: DiagnosticEntry[];
	}
}

function reportDiagnostic(
	stage: string,
	status: DiagnosticStatus,
	detail: string,
) {
	const entry: DiagnosticEntry = {
		time: new Date().toISOString(),
		stage,
		status,
		detail,
	};
	const entries = window.__C7_DIAGNOSTICS__ ?? [];
	entries.push(entry);
	window.__C7_DIAGNOSTICS__ = entries.slice(-40);
	window.dispatchEvent(new CustomEvent("c7:diagnostic", { detail: entry }));
}

function describeError(error: unknown) {
	if (error instanceof Error) {
		return error.stack ?? error.message;
	}
	return String(error);
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
	let stage = "service worker registration";
	reportDiagnostic("Browser", "ok", `Path: ${location.pathname}; secure context: ${isSecureContext}`);

	try {
		if (!("serviceWorker" in navigator)) {
			throw new Error("This browser does not support service workers.");
		}

		reportDiagnostic(stage, "working", "Registering /c7/sw.js with the /c7/ scope.");
		const registration = await withTimeout(
			navigator.serviceWorker.register("/c7/sw.js", {
				scope: "/c7/",
				updateViaCache: "none",
			}),
			20000,
			"Service worker registration",
		);

		const scopeUrl = new URL(registration.scope);
		const pageIsInScope = location.pathname.startsWith(scopeUrl.pathname);
		reportDiagnostic(
			"Service worker registration",
			"ok",
			`Scope: ${scopeUrl.pathname}; page is in scope: ${pageIsInScope}; active: ${registration.active?.state ?? "none"}; installing: ${registration.installing?.state ?? "none"}; waiting: ${registration.waiting?.state ?? "none"}`,
		);
		reportDiagnostic(
			"Page control",
			pageIsInScope ? "ok" : "warning",
			pageIsInScope
				? "The current page path is inside the worker scope."
				: "The slashless /c7 page is outside /c7/. The worker can still handle requests under /c7/, but this page itself is not controlled.",
		);

		stage = "service worker activation";
		reportDiagnostic(stage, "working", "Waiting for the registration's own worker to activate.");
		const serviceWorker = await waitForActiveWorker(registration);
		reportDiagnostic(
			"Service worker activation",
			"ok",
			`Worker state: ${serviceWorker.state}; script: ${new URL(serviceWorker.scriptURL).pathname}`,
		);

		stage = "Scramjet controller startup";
		reportDiagnostic(stage, "working", "Creating the controller and connecting its worker transport.");
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
		reportDiagnostic("Scramjet controller startup", "ok", "Controller is ready.");
		return controller;
	} catch (error) {
		reportDiagnostic(stage, "error", describeError(error));
		throw error;
	}
}

async function mount() {
	try {
		const root = <App />;
		app.replaceWith(root);
	} catch (error) {
		reportDiagnostic("Player interface mount", "error", describeError(error));
		console.error("Cork7 player interface could not be mounted:", error);
		app.innerHTML = "<main class='player-fatal'>Cork7 could not start. Refresh the page to try again.</main>";
	}
}

export const controllerReady = init();
void mount();
