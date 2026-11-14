# Apex Lab Cloud Dashboard

This is the Vercel control UI. It sends Start / Pause / Resume / Reset commands through a Vercel serverless API route. The bearer token is never exposed to browser JavaScript.

The AI training loop, neural policy, evolution and checkpoints run in Northflank, independently of the laptop or browser.

Set these Vercel Production environment variables:
- `APEX_BOT_URL`: public HTTPS base URL of the Northflank `apex-bot-worker` service, without a trailing path.
- `APEX_BOT_TOKEN`: the same random bearer token as the worker's `BOT_CONTROL_TOKEN`.

The dashboard proxies requests through `/api/bot/[action]`; only fixed, allowlisted actions are forwarded.

Best-run frames are stored by the worker on the persistent Northflank volume. The browser renders those frames to WebM when the replay is opened.
