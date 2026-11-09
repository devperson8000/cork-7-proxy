# Vercel edge entry

This folder is the lightweight Vercel deployment for the Cork7 player.

- The Vercel project root is set to this directory, so the Scramjet monorepo is not installed or built on Vercel.
- `/c7` rewrites internally to the Northflank player index at `/c7/`.
- `/c7/:path*` forwards the player assets and nested paths to the same backend.
- Wisp WebSocket traffic connects directly to the dedicated Northflank Wisp endpoint configured in the player build.
- The old public health-check route is intentionally not exposed.

The game frontend and Wisp server remain built and hosted by the Northflank Docker image. Vercel is only the lightweight public entry point.
