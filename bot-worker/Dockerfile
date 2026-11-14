FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
COPY package.json index.mjs ./
RUN mkdir -p /data && chown -R node:node /app /data
USER node:node
EXPOSE 3000
CMD ["node", "index.mjs"]
