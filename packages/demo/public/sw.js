importScripts("/c7/controller/controller.sw.js");

addEventListener("fetch", (event) => {
	if (!$scramjetController.shouldRoute(event)) return;

	event.respondWith((async () => {
		try {
			const response = await $scramjetController.route(event);
			if (response.status >= 500) {
				console.warn(
					"Cork7 upstream request returned HTTP " + response.status,
					event.request.url,
				);
			}
			return response;
		} catch (error) {
			console.error("Cork7 service-worker request failed:", event.request.url, error);
			return new Response("Cork7 could not load this page. Refresh and try again.", {
				status: 502,
				headers: { "Content-Type": "text/plain; charset=utf-8" },
			});
		}
	})());
});
