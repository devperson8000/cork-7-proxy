FROM mcr.microsoft.com/playwright:v1.65.0-noble
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Northflank build context is the repository root.
# Pin the Playwright runtime to the same image version so its Chromium build matches.
COPY bot-worker/package.json ./package.json
RUN npm install --omit=dev

COPY bot-worker/index.mjs ./index.mjs
COPY bot-worker/cork7-agent.mjs ./cork7-agent.mjs

RUN mkdir -p /data && chown -R pwuser:pwuser /app /data
USER pwuser

EXPOSE 3000
CMD ["node", "index.mjs"]
