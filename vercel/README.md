# Vercel edge entry

This folder is the lightweight Vercel deployment for the Cork7 player.

- The Vercel project root is set to this directory, so the Scramjet monorepo is not installed or built on Vercel.
- `/c7` serves the website switcher; its Cork7 player frame loads the Northflank player at `/player/`.
- `/ss` rewrites to the same Northflank Scramjet player with the SaltySeas target selector.
- `/chess` rewrites to the same Northflank Scramjet player at `/chess-player/`, with Chess.com selected as the starting website.
- `/c7/:path*` forwards the Scramjet player assets and shared service-worker scope to the same backend.
- All website aliases share the `/c7/` player assets, service worker, and `/wisp/` WebSocket endpoint.
- Wisp WebSocket traffic connects directly to the dedicated Northflank Wisp endpoint configured in the player build.
- The old public health-check route is intentionally not exposed.

The game frontend and Wisp server remain built and hosted by the Northflank Docker image. Vercel is only the lightweight public entry point.
