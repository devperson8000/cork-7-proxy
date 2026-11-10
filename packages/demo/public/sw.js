importScripts("/c7/controller/controller.sw.js");

function getProxiedTargetHost(request) {
	try {
		const requestUrl = new URL(request.url);
		const decodedPath = decodeURIComponent(requestUrl.pathname);
		const targetStart = decodedPath.indexOf("https://");
		if (targetStart === -1) return "unresolved";
		return new URL(decodedPath.slice(targetStart)).hostname;
	} catch {
		return "unresolved";
	}
}

async function publishNetworkDiagnostic(request, status, errorType) {
	const entry = {
		time: new Date().toISOString(),
		host: getProxiedTargetHost(request),
		method: request.method,
		status,
		errorType: errorType || null,
	};
	try {
		const windows = await self.clients.matchAll({
			type: "window",
			includeUncontrolled: true,
		});
		for (const client of windows) {
			client.postMessage({
				type: "C7_API_NETWORK_DIAGNOSTIC",
				entry,
			});
		}
	} catch (error) {
		console.warn("Could not publish Cork7 network diagnostic:", error?.name ?? "Error");
	}
}

addEventListener("fetch", (event) => {
	if (!$scramjetController.shouldRoute(event)) return;

	event.respondWith((async () => {
		const trackRequest = event.request.destination === "";

		try {
			const response = await $scramjetController.route(event);
			const internalError = response.headers.get("X-C7-Internal-Error");
			if (trackRequest) {
				await publishNetworkDiagnostic(
					event.request,
					response.status,
					internalError ? "SW_INTERNAL: " + internalError : null,
				);
			}
			if (internalError) {
				console.warn(
					"Scramjet internal request error:",
					getProxiedTargetHost(event.request),
					internalError,
				);
			} else if (response.status >= 500) {
				console.warn(
					"Cork7 upstream request returned HTTP " + response.status,
					getProxiedTargetHost(event.request),
				);
			}
			if (internalError) {
				// Keep internal diagnostics out of the response visible to the game.
				const headers = new Headers(response.headers);
				headers.delete("X-C7-Internal-Error");
				return new Response(response.body, {
					status: response.status,
					statusText: response.statusText,
					headers,
				});
			}
			return response;
		} catch (error) {
			if (trackRequest) {
				await publishNetworkDiagnostic(
					event.request,
					502,
					error instanceof Error ? error.name : "NetworkError",
				);
			}
			console.error(
				"Cork7 service-worker request failed:",
				getProxiedTargetHost(event.request),
				error instanceof Error ? error.name : "NetworkError",
			);
			return new Response("Cork7 could not load this page. Refresh and try again.", {
				status: 502,
				headers: { "Content-Type": "text/plain; charset=utf-8" },
			});
		}
	})());
});
