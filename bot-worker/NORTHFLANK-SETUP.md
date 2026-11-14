# Northflank setup — Apex Bot Worker

This guide deploys the cloud trainer as a separate project called **apex-bot** in the same Northflank organisation as the existing **cork7** project.

The existing Cork7 proxy service is `cork7/cork7-wisp`. Do not edit or redeploy it for this setup.

## 1. Create the project

1. Open your Northflank organisation/team dashboard.
2. Select **Create project**.
3. Name it `apex-bot`.
4. Choose a region supported by your account. A region close to you is suitable because the worker is CPU-only and the Vercel dashboard is accessed from your browser.
5. Create the project.

Northflank's Developer/Sandbox project allowance has changed across documentation. If your dashboard refuses a second project on the free plan, create the worker as a second service in the existing `cork7` project instead. Do not upgrade a plan or enter payment details just to get past a limit.

## 2. Create the combined service

1. Inside `apex-bot`, choose **Create new → Service → Combined**.
2. Service name: `apex-bot-worker`.
3. Connect GitHub repository: `devperson8000/cork-7-proxy`.
4. Branch: `feature/cork7-northflank-backend`.
5. Build type: **Dockerfile**.
6. Dockerfile path: `/bot-worker/Dockerfile`.
7. Build context: repository root (`/`).
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

Choose the smallest CPU plan initially:

- `nf-compute-10`
- `0.1` shared vCPU
- `256` MB memory
- One instance

Northflank currently lists this plan at approximately **US$2.70/month**, with a 1 GiB disk around **US$0.15/month**. It is intentionally conservative to protect the shared free resource allowance. Training will be slower than on a larger CPU. Check the organisation's resource usage before leaving it running; the existing Cork7 proxy also consumes part of the shared allowance.

If the worker is stable and there is room in the allowance, `nf-compute-20` (0.2 shared vCPU / 512 MB) is the next step up. Do not select GPU resources.

## 7. Health check

Configure an HTTP health check:

- Path: `/health`
- Port: `3000`
- Method: `GET`

After the first deployment, open the generated public HTTPS hostname with `/health`. It should return JSON containing `"status":"ok"`.

The API starts paused. It will not train until the Vercel dashboard sends a Start command.

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
4. Confirm status changes to **CLOUD TRAINING ACTIVE** and run count/generation begin increasing.
5. Close the laptop or browser. The Northflank service continues running and checkpointing.
6. Reopen the dashboard. It should restore the latest telemetry and best-run data.
7. Use **Pause** and **Resume** to confirm remote controls.
8. When a best run exists, select **Watch best run** to render a WebM replay from the saved frames.

## Scope note

The worker trains the independent Apex Lab skiing simulation. It does not automate the official Cork7 website, inject inputs into a Cork7 account, inspect private game state, or submit Cork7 scores. The existing `cork7-wisp` service remains untouched.
