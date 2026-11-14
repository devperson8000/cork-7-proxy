FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data

# Northflank build context is the repository root, while this Dockerfile lives
# in bot-worker/. Copy the worker files from that repository-relative path.
COPY bot-worker/package.json bot-worker/index.mjs ./

RUN mkdir -p /data && chown -R node:node /app /data
USER node:node

EXPOSE 3000
CMD ["node", "index.mjs"]
