# Northflank setup — Apex Bot Worker

This guide deploys the cloud trainer as a separate project called **apex-bot** in the same Northflank organisation as the existing **cork7** project.

The existing Cork7 proxy service is `cork7/cork7-wisp`. Do not edit or redeploy it for this setup.

## 1. Create the project

1. Open your Northflank organisation/team dashboard.
2. Select **Create project**.
3. Name it `apex-bot`.
4. Choose a region supported by your account. The worker now runs a headless Chromium browser as well as the CPU-based Apex simulator.
5. Create the project.

Northflank's Developer/Sandbox project allowance has changed across documentation. If your dashboard refuses a second project on the free plan, create the worker as a second service in the existing `cork7` project instead. Do not upgrade a plan or enter payment details just to get past a limit.

## 2. Create the combined service

1. Inside `apex-bot`, choose **Create new → Service → Combined**.
2. Service name: `apex-bot-worker`.
3. Connect GitHub repository: `devperson8000/cork-7-proxy`.
4. Branch: `feature/cork7-northflank-backend`.
5. Build type: **Dockerfile**.
6. Dockerfile path: `/bot-worker/Dockerfile`.
7. Build context: repository root (`/`). The Dockerfile copies `bot-worker/package.json`, `bot-worker/index.mjs` and `bot-worker/cork7-agent.mjs` relative to this context. It uses the pinned Playwright browser image so the Chromium and Playwright versions match.
8. Runtime command: leave the Dockerfile default (`node index.mjs`).
9. Create the service.

The service builds only the small worker image. It does not build or change Scramjet.

## 3. Set runtime environment variables

Open the service's **Environment** settings and add:

| Key | Value |
|---|---|
| `PORT` | `3000` |
| `DATA_DIR` | `/data` |
| `BOT_CONTROL_TOKEN` | The shared random token from the setup message |

Keep the token private. Do not put it in GitHub, screenshots, browser code, or a public URL.

## 4. Networking

Open **Configure → Networking** and add:

- Port: `3000`
- Protocol: `HTTP`
- Accessibility: **Public**
- Port name: `api`

Use the generated HTTPS service hostname after deployment. The Vercel serverless function contacts this public endpoint with a bearer token; the browser never receives that token.

## 5. Persistent learning storage

Open the service's **Volumes** section and create a volume:

- Name: `apex-learning-data`
- Access mode: **Single Read/Write**
- Size: `1 GiB`
- Container mount path: `/data`
- Instances: `1`

This is required. Without a persistent volume, learning checkpoints can be lost when the container is replaced. The worker writes `/data/apex-state.json` and restores it on restart.

## 6. Resources and free allowance

**Important:** the old `256 MB` simulator allocation is too small for Chromium + Cork7's WebGL 2 game. The live browser agent needs at least **1 GiB memory**, with **2 GiB recommended** for more reliable WebGL sessions, and one shared vCPU or more. Use only resources already available in your organisation's current allowance. Do not purchase an upgrade just for this. If the current allocation cannot provide 1 GiB, the simulator may still run but the real Cork7 browser session is likely to be killed for memory.

## 7. Health check

Configure an HTTP health check:

- Path: `/health`
- Port: `3000`
- Method: `GET`

After the first deployment, open the generated public HTTPS hostname with `/health`. It should return JSON containing `"status":"ok"`.

The Apex simulator starts paused. The Cork7 browser is also closed until you select a park and press **Launch Solo**. Chromium starts asynchronously; use **Refresh view** until the actual game is loaded. Start the real-game trainer only after the dashboard reports the phase as `game`.

## 8. Connect Vercel

In the Northflank service overview, copy the generated HTTPS hostname. In the existing Vercel project **cork7game**, open **Settings → Environment Variables** and add to **Production**:

| Key | Value |
|---|---|
| `APEX_BOT_URL` | The generated Northflank HTTPS service hostname, e.g. `https://your-service-name.your-project.code.run` |
| `APEX_BOT_TOKEN` | The same shared random token used for `BOT_CONTROL_TOKEN` |

Do not include `/health` or `/api` at the end of `APEX_BOT_URL`. Save and redeploy Vercel so the serverless function receives the variables.

## 9. Verify end-to-end

1. Open `https://cork7game.vercel.app/bot/`.
2. Wait for the status pill to show **WORKER CONNECTED / PAUSED**.
3. Press **Start**.
4. Confirm the Apex simulator changes to **CLOUD TRAINING ACTIVE**. For the real-game test, use the Cork7 panel: select APEX, press **Launch Solo**, wait for the live screenshot, then press **Start AI trainer**. The Cork7 trainer records only a score it can read from the game's results screen.
5. The cloud worker stores the Apex state and Cork7 trainer's best policy in `/data`; the headless game session runs on Northflank while the worker is active.
6. Reopen the dashboard. It should restore the latest telemetry and best-run data.
7. Use **Pause** and **Resume** to confirm remote controls.
8. When a best run exists, select **Watch best run** to render a WebM replay from the saved frames.

## Scope note

The Cork7 agent opens a fresh, unsigned Solo browser context and uses normal keyboard inputs. It does not sign in, enter multiplayer/ranked modes or submit scores through a Cork7 account. Score-based training depends on the current results screen exposing the score as page text; if it is canvas-only, the trainer stops and reports that rather than inventing a result. The existing `cork7-wisp` service remains untouched.
