# Deploy the Cork7 player and Wisp backend on Northflank

This service provides one shared Scramjet player through `/c7/`, `/saltyseas-player/`, and `/chess-player/`, plus the Wisp WebSocket endpoint at `/wisp/`. Vercel selects Cork7, SaltySeas, or Chess.com as the starting website. The backend keeps an exact hostname allowlist; it is not an unrestricted proxy.

## 1. Northflank service

1. Open your Northflank project `cork7`.
2. Open the existing Combined service `cork7-wisp`.
3. Confirm it is connected to `devperson8000/cork-7-proxy` on branch `feature/cork7-northflank-backend`.
4. Select the Dockerfile build option.
5. Dockerfile path: `/Dockerfile`; build context: repository root.
6. The Dockerfile compiles the Scramjet WebAssembly rewriter, the Scramjet/controller bundles and the fixed Cork7 player, then copies the player build into the runtime image.

The first build can take longer because it compiles the Rust WebAssembly rewriter and the JavaScript bundles.

After the source update is merged, open **Secrets & Configs → Environment Variables** for `cork7-wisp` and update `CORK7_ALLOWED_HOSTS` to the full comma-separated value in the table above. Keep `ALLOWED_ORIGINS` as `https://cork7game.vercel.app`. Save the change and redeploy the service so the Chess.com alias and allowlist become active.

## 2. Runtime variables

| Variable | Value |
| --- | --- |
| `PORT` | `3000` |
| `CORK7_ALLOWED_HOSTS` | `cork7.com,www.cork7.com,live.cork7.com,agfhgulgtsocvioqqxvi.supabase.co,saltyseas.io,cdn.saltyseas.io,api-eu-1.saltyseas.io,accounts.google.com,www.googletagmanager.com,region1.google-analytics.com,chess.com,www.chess.com,api.chess.com,live.chess.com,live2.chess.com,websockets.gcp-prod.chess.com,images.chesscomfiles.com,avatars.chesscomfiles.com,files.chesscomfiles.com` |
| `ALLOWED_ORIGINS` | `https://cork7game.vercel.app` |
| `MAX_WS_CONNECTIONS` | `60` |
| `NETWORK_DIAGNOSTICS_TOKEN` | A long, private random token used to access the network diagnostics dashboard. Set this before using diagnostics. |

The list includes exact Cork7 and SaltySeas hosts plus Chess.com page, API, live-game, and image hosts. No wildcard hosts are enabled. If Chess.com loads but sign-in or live games are incomplete, use the protected Network Diagnostics dashboard to identify the exact blocked hostname, verify it belongs to the Chess.com experience, append that hostname to this variable, and redeploy.

## 3. Network diagnostics

Set `NETWORK_DIAGNOSTICS_TOKEN` in the Northflank service environment to a long, private random value. Keep it private; it grants access to recent network request hostnames and connection outcomes.

After redeploying the service, open:

```text
https://YOUR-NORTHFLANK-HOST/diagnostics
```

Enter the token to view a live-updating log of Wisp stream requests, successful connections, blocked connections, failures, close reasons, ports, timestamps and connection duration. The dashboard retains the latest 500 events in memory; logs reset when the service restarts. The API is protected with a bearer token, and the diagnostics page itself does not expose the event data without that token. The log can be cleared from the dashboard.

The diagnostics page is served directly by Northflank; it is not part of the Vercel game routes.

## 4. Networking

Expose:

- Port: `3000`
- Protocol: `HTTP`
- Accessibility: `Public`
- Port name: `wisp`

Health check: HTTP GET `/health` on port `3000`.

Northflank's HTTPS ingress provides TLS. The browser's Wisp connection uses `wss://`.

## 5. Confirm the service

- `https://YOUR-NORTHFLANK-HOST/health` should return JSON with `"status":"ok"`.
- `https://YOUR-NORTHFLANK-HOST/c7/` should return the Scramjet player HTML.
- `https://YOUR-NORTHFLANK-HOST/chess-player/` should return the same Scramjet player with Chess.com selected as the starting website.
- The `/health` endpoint reports whether the server and built player assets are ready. It does not test an actual game session.

## 6. Vercel path routing

The Vercel project serving `cork7game.vercel.app` has a route for `/c7/:path*` to serve the player assets, a dedicated `/ss` rewrite for SaltySeas, and `/chess` plus `/chess/:path*` rewrites for Chess.com. The Chess route forwards to the Northflank `/chess-player/` alias. The Scramjet runtime still loads shared assets and its service worker under `/c7/`. Point the player asset route to:

```text
https://YOUR-NORTHFLANK-HOST/c7/:path*
```

This is an external rewrite: the browser keeps `cork7game.vercel.app/c7/` in its address bar while Vercel fetches the player assets from Northflank.

The existing Vercel `VITE_WISP_URL` environment variable remains available, but this deployment builds the player in the Northflank Docker image. The baked-in default Wisp URL is the Northflank public hostname configured in `packages/demo/src/store.ts`. Change that default if the Northflank hostname changes.

## 7. How the player works

- `/c7/` opens `https://cork7.com/` by default.
- Vercel's `/ss` route loads `/saltyseas-player/`, which selects `https://saltyseas.io/app/`.
- Vercel's `/chess` route loads `/chess-player/`, which selects `https://www.chess.com/`.
- All three aliases reuse the same built Scramjet files and `/c7/` service-worker scope; only the starting target URL and player header theme differ.
- The target URL is validated against the exact allowlist before it is injected into the player.
- Scramjet's service worker is scoped to `/c7/`; its internal virtual URL prefix and script paths are also under `/c7/`.
- Wisp permits only the exact destination hosts listed in `CORK7_ALLOWED_HOSTS` and ports 80/443, including the Chess.com page/API/live hosts and image CDNs.
- Cork7's account/API destination is restricted to the exact host `agfhgulgtsocvioqqxvi.supabase.co`; other Supabase projects remain blocked.
- Direct-IP, private-network, loopback and UDP destinations are disabled.
- The player opens its Wisp WebSocket connection when the game starts. Confirm multiplayer by joining the same live room from two separate player sessions.

A successful health check confirms the HTTP server is running. A successful WSS status confirms the browser can complete the WebSocket handshake. Neither alone guarantees every Cork7 asset or multiplayer feature is working; if game assets are blocked, verify the exact additional Cork7 hostname before adding it.

## 8. Troubleshooting

- **Build fails at `wasm-snip`:** check the Northflank build log; the Dockerfile installs the fork required by the repository's rewriter script.
- **Health works but `/c7/` returns 404:** check that the Docker build completed the Vite player build and copied `packages/demo/dist`.
- **Player assets fail:** check the Vercel `/c7/:path*` external rewrite and confirm the destination includes `/c7/:path*`.
- **Chess.com opens but some features do not:** view `/diagnostics`, identify the exact blocked Chess.com hostname, append only that verified hostname to `CORK7_ALLOWED_HOSTS`, and redeploy. Avoid wildcard entries.
- **WebSocket indicator fails:** confirm the public hostname and `ALLOWED_ORIGINS` match the current deployment and Vercel domain.
- **A proxied site's assets do not load:** the Wisp allowlist is intentionally exact. Verify any additional required hostname with the site owner before allowing that exact host; do not add wildcard access.
