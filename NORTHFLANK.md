# Deploy the Cork7 player and Wisp backend on Northflank

This service provides the Scramjet player at `/c7/` and the Wisp WebSocket endpoint at `/wisp/`. It opens either the official Cork7 game or the dedicated Saltyseas destination selected by Vercel's `/ss` route. The backend keeps an exact hostname allowlist; it is not an unrestricted proxy.

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
| `CORK7_ALLOWED_HOSTS` | `cork7.com,www.cork7.com,live.cork7.com,agfhgulgtsocvioqqxvi.supabase.co,saltyseas.io` |
| `ALLOWED_ORIGINS` | `https://cork7game.vercel.app` |
| `MAX_WS_CONNECTIONS` | `60` |

The Cork7 game hosts and the Saltyseas hostname are exact entries. The observed account/API host `agfhgulgtsocvioqqxvi.supabase.co` is also included as one exact hostname so Cork7 can reach its account service. No wildcard hosts are enabled.

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
- `https://YOUR-NORTHFLANK-HOST/c7/` should return the Scramjet player HTML.
- The `/health` endpoint reports whether the server and built player assets are ready. It does not test an actual game session.

## 5. Vercel path routing

The Vercel project serving `cork7game.vercel.app` has a route for `/c7/:path*` to serve the player assets and a dedicated `/ss` rewrite to load the same player with the Saltyseas selection. Point the player asset route to:

```text
https://YOUR-NORTHFLANK-HOST/c7/:path*
```

This is an external rewrite: the browser keeps `cork7game.vercel.app/c7/` in its address bar while Vercel fetches the player assets from Northflank.

The existing Vercel `VITE_WISP_URL` environment variable remains available, but this deployment builds the player in the Northflank Docker image. The baked-in default Wisp URL is the Northflank public hostname configured in `packages/demo/src/store.ts`. Change that default if the Northflank hostname changes.

## 6. How the player works

- The player loads `https://cork7.com/` by default.
- Vercel's `/ss` route passes the fixed `site=saltyseas` selector, which changes the initial target to `https://saltyseas.io/app/`.
- The target URL is validated against the exact allowlist before it is injected into the player.
- Scramjet's service worker is scoped to `/c7/`; its internal virtual URL prefix and script paths are also under `/c7/`.
- Wisp permits only the exact destination hosts listed in `CORK7_ALLOWED_HOSTS` and ports 80/443, including `saltyseas.io`.
- Cork7's account/API destination is restricted to the exact host `agfhgulgtsocvioqqxvi.supabase.co`; other Supabase projects remain blocked.
- Direct-IP, private-network, loopback and UDP destinations are disabled.
- The player opens its Wisp WebSocket connection when the game starts. Confirm multiplayer by joining the same live room from two separate player sessions.

A successful health check confirms the HTTP server is running. A successful WSS status confirms the browser can complete the WebSocket handshake. Neither alone guarantees every Cork7 asset or multiplayer feature is working; if game assets are blocked, verify the exact additional Cork7 hostname before adding it.

## Troubleshooting

- **Build fails at `wasm-snip`:** check the Northflank build log; the Dockerfile installs the fork required by the repository's rewriter script.
- **Health works but `/c7/` returns 404:** check that the Docker build completed the Vite player build and copied `packages/demo/dist`.
- **Player assets fail:** check the Vercel `/c7/:path*` external rewrite and confirm the destination includes `/c7/:path*`.
- **WebSocket indicator fails:** confirm the public hostname and `ALLOWED_ORIGINS` match the current deployment and Vercel domain.
- **A proxied site's assets do not load:** the Wisp allowlist is intentionally exact. Verify any additional required hostname with the site owner before allowing that exact host; do not add wildcard access.
