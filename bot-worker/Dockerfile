FROM mcr.microsoft.com/playwright:v1.65.0-noble
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Build from repository root. The Playwright image already includes Chromium
# and its system libraries; install the matching Node package separately.
COPY bot-worker/package.json ./package.json
RUN npm install --omit=dev && mkdir -p /data

COPY bot-worker/index.mjs ./index.mjs
COPY bot-worker/cork7-agent.mjs ./cork7-agent.mjs

# The agent launches Chromium with --no-sandbox, matching the image's default
# root-user mode for this trusted, user-authorised game-testing target.
EXPOSE 3000
CMD ["node", "index.mjs"]
