# Deploy the Cork7 player and Wisp backend on Northflank

This service provides both the fixed Cork7 player at `/c7/` and the Wisp WebSocket endpoint at `/wisp/`. The player has no general-purpose address bar. Its initial destination is the official Cork7 game, and the backend allows only exact Cork7 hostnames.

## 1. Northflank service

1. Open your Northflank project `cork7`.
2. Open the existing Combined service `cork7-wisp`.
3. Confirm it is connected to `devperson8000/cork-7-proxy` on branch `feature/cork7-northflank-backend`.
4. Select the Dockerfile build option.
5. Dockerfile path: `/Dockerfile`; build context: repository root.
6. The Dockerfile compiles the Scramjet WebAssembly rewriter, the Scramjet/controller bundles and the fixed Cork7 player, then copies the player build into the runtime image.

The first build can take longer because it compiles the Rust WebAssembly rewriter and the JavaScript bundles.

## 2. Runtime variables

| Variable | Value |
| --- | --- |
| `PORT` | `3000` |
| `CORK7_ALLOWED_HOSTS` | `cork7.com,www.cork7.com,live.cork7.com` |
| `ALLOWED_ORIGINS` | `https://cork7game.vercel.app` |
| `MAX_WS_CONNECTIONS` | `60` |

The official Cork7 updates identify `live.cork7.com` as the game's live multiplayer service. It is included as an exact hostname, not as a wildcard.

## 3. Networking

Expose:

- Port: `3000`
- Protocol: `HTTP`
- Accessibility: `Public`
- Port name: `wisp`

Health check: HTTP GET `/health` on port `3000`.

Northflank's HTTPS ingress provides TLS. The browser's Wisp connection uses `wss://`.

## 4. Confirm the service

- `https://YOUR-NORTHFLANK-HOST/health` should return JSON with `"status":"ok"`.
- `https://YOUR-NORTHFLANK-HOST/c7/` should return the Cork7 player HTML.
- The player page shows its own backend and WebSocket status indicators; opening browser developer tools is not required.

## 5. Vercel path routing

The Vercel project serving `cork7game.vercel.app` has a route for `/c7/:path*`. Point that route to:

```text
https://YOUR-NORTHFLANK-HOST/c7/:path*
```

This is an external rewrite: the browser keeps `cork7game.vercel.app/c7/` in its address bar while Vercel fetches the player assets from Northflank.

The existing Vercel `VITE_WISP_URL` environment variable remains available, but this deployment builds the player in the Northflank Docker image. The baked-in default Wisp URL is the Northflank public hostname configured in `packages/demo/src/store.ts`. Change that default if the Northflank hostname changes.

## 6. How the player works

- The player loads only `https://cork7.com/` by default.
- Any optional `goto` value is accepted only for `https://cork7.com`, `https://www.cork7.com`, or `https://live.cork7.com`.
- Scramjet's service worker is scoped to `/c7/`; its internal virtual URL prefix and script paths are also under `/c7/`.
- Wisp permits only the exact destination hosts listed in `CORK7_ALLOWED_HOSTS` and ports 80/443.
- Direct-IP, private-network, loopback and UDP destinations are disabled.
- The health panel checks the backend and opens a short WebSocket connection so the user can see status without developer tools.

A successful health check confirms the HTTP server is running. A successful WSS status confirms the browser can complete the WebSocket handshake. Neither alone guarantees every Cork7 asset or multiplayer feature is working; if game assets are blocked, verify the exact additional Cork7 hostname before adding it.

## Troubleshooting

- **Build fails at `wasm-snip`:** check the Northflank build log; the Dockerfile installs the fork required by the repository's rewriter script.
- **Health works but `/c7/` returns 404:** check that the Docker build completed the Vite player build and copied `packages/demo/dist`.
- **Player assets fail:** check the Vercel `/c7/:path*` external rewrite and confirm the destination includes `/c7/:path*`.
- **WebSocket indicator fails:** confirm the public hostname and `ALLOWED_ORIGINS` match the current deployment and Vercel domain.
- **Some game functionality is unavailable:** check the blocked hostname from the game's own network diagnostics, verify it belongs to Cork7, then add only that exact hostname.
