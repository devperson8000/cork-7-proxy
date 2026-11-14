# Cork7 AI Lab Worker

Northflank service for two separate learners:

1. **Apex simulator** — the original independent skiing simulator and neuroevolution trainer.
2. **Cork7 Solo agent** — a Playwright-controlled Chromium session that opens the real public Cork7 website without signing in, sends normal game keyboard inputs, reads the visible results page when possible and evolves timed trick-key policies from the score it can read.

## Runtime

- Official Playwright Docker image: `mcr.microsoft.com/playwright:v1.65.0-noble`
- Node.js 26 runtime with matching Playwright 1.65.0 Chromium
- HTTP port 3000
- `BOT_CONTROL_TOKEN`: random bearer token, at least 32 characters
- `DATA_DIR=/data`: mount a Northflank persistent volume at `/data`
- The Apex simulator and Cork7 trainer both start paused.
- Saved policy and trainer history: `/data/cork7-training.json`
- Apex simulation checkpoints: `/data/apex-state.json`

## API

All routes below except `GET /health` require the bearer token.

- `GET /health`
- `GET /api/status`, `GET /api/replay`
- `POST /api/coach`: stores player coaching metrics and adjusts the simulator and Cork7 policy mutation profile.
- `POST /api/start`, `/api/pause`, `/api/resume`, `/api/reset`: Apex simulator controls.
- `GET /api/cork7/status`, optionally with `?screenshot=1`
- `POST /api/cork7/start` with `{"park":"APEX"}`
- `POST /api/cork7/act` with a small list of normal game keys and a short hold duration
- `POST /api/cork7/restart`, `/api/cork7/stop`
- `POST /api/cork7/train-start`, `/api/cork7/train-pause`

The Cork7 trainer tests timed trick-key policies in Solo, reads the results-screen score when it is available, records the best policy and mutates the next attempt. It stops with a diagnostic instead of inventing a score if the results text cannot be read.

## Cork7 session scope

- Opens a fresh browser context with no saved login or account credentials.
- Uses Solo mode only; no multiplayer, ranked queue, account sign-in or leaderboard interaction is implemented.
- Uses ordinary keyboard inputs documented by Cork7.
- The game itself is loaded from cork7.com; the worker does not copy or host Cork7's game files.
- Video is not uploaded to the worker. The session screenshot is returned only to the authenticated dashboard request.

The site’s menus and results text can change as Cork7 is updated. The first live session must be checked to confirm that its game view and results score are detectable. If the score is canvas-only, add a dedicated visual score reader before treating the autonomous trainer as validated.

## Security

The Vercel API proxy holds the bearer token server-side. Do not put the token in browser JavaScript, screenshots or GitHub. Keep the worker's public HTTPS API behind the bearer-token check.
