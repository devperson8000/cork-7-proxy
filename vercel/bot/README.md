# Apex Lab + Cork7 AI Dashboard

This Vercel dashboard connects to the Northflank worker through `/api/bot/[action]`. The bearer token is never exposed to browser JavaScript.

## AI systems

- **Apex simulator:** independent neural-policy simulation with evolution and persistent checkpoints.
- **Cork7 Solo agent:** a separate Playwright Chromium session on the worker, using the actual Cork7 website and documented keyboard controls. It evolves timed trick-key policies from the results-screen score when that score is readable.
- **Replay Coach:** `/coach/` analyses player-provided run data and sends aggregate coaching metrics to the worker.

Cork7 browser sessions are fresh and unsigned. The dashboard exposes Solo session start/stop, screenshot refresh, restart and normal key controls, plus Start/Pause for the score-based trainer. It does not log in, enter multiplayer/ranked modes or submit score records through an account.

## Vercel environment variables

- `APEX_BOT_URL`: public HTTPS base URL of the Northflank `apex-bot-worker` service, without a trailing path.
- `APEX_BOT_TOKEN`: same random bearer token as `BOT_CONTROL_TOKEN` on Northflank.

Only fixed, allowlisted actions are proxied. Persistent learning data remains on the Northflank volume.
