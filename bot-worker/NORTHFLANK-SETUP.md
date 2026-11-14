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

## 6. Resources — stay inside the free Sandbox allowance

**Do not upgrade to a paid Northflank plan or add a payment method for this project.** Northflank currently lists the free Sandbox as including up to **US$20/month of Northflank Cloud resources**, across the free resource allowance. The allowance is shared with the other services/addons in the account, not reserved just for this bot.

The worker is currently reporting **244 MB RAM and 0.1 vCPU** (`nf-compute-10`). That is too small for Chromium + Cork7 WebGL. Do not keep retrying the browser at that size.

The smallest official plan worth testing for this browser is:

- Plan ID: `nf-compute-50`
- Resources: **0.5 shared vCPU + 1,024 MB RAM**
- Published list price: **US$12/month** at continuous use, billed by the second

This is only a candidate **if** the Northflank Sandbox resource selector offers it for this account and the Billing/Usage estimate confirms that all services together remain within the existing US$20 monthly free allowance. If the updated estimate exceeds the free allowance, cancel the change and keep the current settings. Do not select `nf-compute-100-2` (2 GB) because its published US$24/month price exceeds the entire free resource allowance by itself.

To check/change it in Northflank:

1. Open the `apex-bot-worker` service and go to **Resources**.
2. Check the available compute plans and select `nf-compute-50` only if it is offered within your Sandbox account.
3. Review **Billing → Usage** and confirm the total estimated monthly resource use stays at or below US$20, including your existing Cork7 proxy service, any database/addons, persistent disk, and egress.
4. If the total remains within the allowance, choose **Update & restart**. Otherwise cancel and leave the current plan unchanged.

The dashboard and worker will allow a browser launch only when the worker reports at least **1,024 MB RAM** and at least **0.25 vCPU**. The smaller viewport and software-rendering settings reduce load, but a 0.5-vCPU shared allocation may still be slow or throttled. This is a minimum test configuration, not a guarantee that every Cork7 WebGL session will run smoothly.

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
