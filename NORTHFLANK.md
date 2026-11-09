# Deploy the Cork7 Wisp backend on Northflank

This repository now includes a dedicated Wisp WebSocket service for the Cork7 page. It is separate from the Scramjet demo UI and is configured to allow only the exact Cork7 destination hostnames listed in `CORK7_ALLOWED_HOSTS`.

## 1. Create the Northflank service

1. Open Northflank and create or select the `cork7` project.
2. Create a **Combined service** connected to `devperson8000/cork-7-proxy`.
3. Select branch `feature/cork7-northflank-backend`.
4. Choose the Dockerfile build option.
5. Set the Dockerfile path to `/Dockerfile` and the build context to the repository root.
6. Name the service `cork7-wisp`.

The Dockerfile pins Node.js 24 and pnpm 12.17.0, installs the locked workspace dependencies, and starts only `server/wisp-server.mjs`. It does not start the general-purpose Scramjet demo.

## 2. Add runtime variables

Add these variables in the Northflank service's runtime environment:

| Variable | Value | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP and WebSocket listener |
| `CORK7_ALLOWED_HOSTS` | `cork7.com,www.cork7.com` | Exact outbound hostname allowlist |
| `ALLOWED_ORIGINS` | `https://cork7game.vercel.app` | Exact browser origin permitted to open the WebSocket |
| `MAX_WS_CONNECTIONS` | `60` | Maximum concurrent WebSocket sessions per service instance |

These values are also provided in `.env.northflank.example`. No API key or password is required by this backend.

**Important:** the hostname list is deliberately exact. Do not replace it with `*` or a broad wildcard. If Cork7 needs another host for assets or game services, verify that hostname first and add only that exact hostname to `CORK7_ALLOWED_HOSTS`.

## 3. Expose the service

Under the service's networking settings, add:

- **Port:** `3000`
- **Protocol:** `HTTP` (Northflank's HTTP ingress supports WebSocket upgrades)
- **Accessibility:** `Public`
- **Port name:** `wisp`

Set the health check to an HTTP GET request to `/health` on port `3000`. The endpoint should return JSON with `"status":"ok"`.

Northflank terminates public TLS at its ingress. The browser therefore connects using `wss://`, not `ws://`.

## 4. Connect the Vercel frontend

After the service is deployed, copy its generated public hostname. In the Vercel project serving `https://cork7game.vercel.app`, add this environment variable for the Production environment:

```text
VITE_WISP_URL=wss://YOUR-NORTHFLANK-PUBLIC-HOST/wisp/
```

Replace `YOUR-NORTHFLANK-PUBLIC-HOST` with the actual hostname shown by Northflank. Do not include `https://` in the hostname portion; the value must start with `wss://` and end with `/wisp/`.

Redeploy the Vercel frontend after changing the variable. Vite variables are embedded at build time.

The frontend must be configured to use this Wisp URL. Setting the variable alone does not change a frontend that has not integrated the Scramjet client.

## 5. Verify the deployment

1. Open `https://YOUR-NORTHFLANK-PUBLIC-HOST/health`. It should return `200` and `{"status":"ok",...}`.
2. Open the Cork7 page and check the browser console for a successful Wisp WebSocket connection.
3. Confirm that the game loads.
4. A connection from an unlisted browser origin should receive `403`.
5. A request to an unlisted destination hostname or to a destination port other than 80/443 should be blocked by Wisp.

## Security notes

- Private IP ranges, loopback addresses, direct-IP destinations, and UDP streams are disabled.
- The Wisp backend accepts WebSocket upgrades only at `/wisp/`.
- The backend checks the browser `Origin` against `ALLOWED_ORIGINS`.
- The Wisp hostname and port allowlists are enforced server-side; hiding the address bar or restricting the frontend UI is not treated as a security boundary.
- An Origin check is a browser protection, not user authentication. Anyone who can run a custom client can spoof an Origin header, so keep the strict destination allowlist and resource limits in place.
- This service is not an anonymity service. Use HTTPS/WSS and do not send passwords or other sensitive information through a proxy unless the game itself supports and documents that usage.

## Troubleshooting

- **Health check fails:** check the build logs and confirm port `3000` is configured as HTTP.
- **WebSocket returns 403:** make sure the actual frontend origin appears exactly in `ALLOWED_ORIGINS`.
- **WebSocket connects but Cork7 assets fail:** inspect the blocked destination hostname, verify it belongs to Cork7, and add that exact hostname to `CORK7_ALLOWED_HOSTS`. Do not enable arbitrary hostnames.
- **Frontend still uses localhost:** verify `VITE_WISP_URL` is set in the correct Vercel project and Production environment, then redeploy.
