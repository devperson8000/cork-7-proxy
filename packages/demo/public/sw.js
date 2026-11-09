importScripts("/c7/controller/controller.sw.js");

function reportScramjetError(clientId, requestUrl, message) {
	const detail = {
		c7Diagnostic: {
			error: message,
			request: requestUrl,
			time: new Date().toISOString(),
		},
	};
	const notification = self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
		for (const client of clients) {
			client.postMessage(detail);
		}
	}).catch((error) => {
		console.error("Could not publish Cork7 diagnostics:", error);
	});
	if (clientId) {
		console.error("Cork7 Scramjet request failed:", requestUrl, message);
	}
	return notification;
}

addEventListener("fetch", (event) => {
	if (!$scramjetController.shouldRoute(event)) return;

	event.respondWith((async () => {
		try {
			const response = await $scramjetController.route(event);
			if (response.status >= 500) {
				let body = "Service worker returned HTTP " + response.status;
				try {
					body = await response.clone().text();
				} catch {}
				await reportScramjetError(event.clientId, event.request.url, body.slice(0, 1000));
			}
			return response;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await reportScramjetError(event.clientId, event.request.url, message);
			return new Response("Internal Service Worker Error: " + message, {
				status: 500,
				headers: { "Content-Type": "text/plain; charset=utf-8" },
			});
		}
	})());
});
