importScripts("/c7/controller/controller.sw.js");

addEventListener("fetch", (event) => {
	if (!$scramjetController.shouldRoute(event)) return;

	event.respondWith(
		$scramjetController.route(event).catch(() =>
			new Response("Cork7 could not load this page. Refresh and try again.", {
				status: 502,
				headers: { "Content-Type": "text/plain; charset=utf-8" },
			})
		),
	);
});
