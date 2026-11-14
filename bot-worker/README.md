# Apex Bot Worker

Always-on Northflank service for the Apex Lab learning simulator.

## Runtime

- Node.js 24, built from `bot-worker/Dockerfile`
- HTTP port 3000
- `BOT_CONTROL_TOKEN`: random bearer token (at least 32 characters)
- `DATA_DIR=/data`: mount a Northflank persistent volume at `/data`
- Starts paused. Vercel sends Start / Pause / Resume commands.
- Saves policy weights, generation, trick discoveries, run counters and best-run frame data to `/data/apex-state.json`.

## API

- `GET /health` (unauthed, non-sensitive health check)
- `GET /api/status` (Bearer token)
- `GET /api/replay` (Bearer token)
- `POST /api/coach` (Bearer token): saves a compact player-performance profile from the Replay Coach; it adjusts simulator fitness priorities for clean landings, crash avoidance and trick variety
- `POST /api/start`, `/api/pause`, `/api/resume`, `/api/reset` (Bearer token)

The worker runs an original Apex-inspired skiing simulation with a compact neural policy and neuroevolution: tournament selection, elite preservation, crossover, Gaussian mutation with adaptive mutation strength, and novelty rewards for discovering trick variety. Replay Coach summaries can tune the fitness weights; video files and Cork7 gameplay sessions are not sent to this service.

## Northflank setup

Create a combined service named `apex-bot-worker` from `devperson8000/cork-7-proxy`, branch `feature/cork7-northflank-backend`.

- Build type: Dockerfile
- Dockerfile path: `/bot-worker/Dockerfile`
- Build context: repository root (`/`)
- Runtime port: `3000`, HTTP, Public
- Health check: `GET /health`
- Instance count: 1
- Attach a Single Read/Write persistent volume, 1 GiB, mounted at `/data`
- Set `PORT=3000`, `DATA_DIR=/data`, and `BOT_CONTROL_TOKEN` to the same token configured in Vercel as `APEX_BOT_TOKEN`.

A public HTTP port is used because the Vercel API function is outside Northflank's private project network. The API is protected by a bearer token. Do not put the token in browser JavaScript or a public repository.

## Scope

This service trains the independent Apex Lab simulator. It does not automate Cork7's official gameplay, read private game state, or submit runs to Cork7.
