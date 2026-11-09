FROM node:24-bookworm-slim

WORKDIR /app

# Pin pnpm to the version declared by this monorepo.
RUN npm install --global pnpm@12.17.0

# Install the workspace exactly as locked. The Wisp server package is currently
# declared in the root workspace devDependencies, so retain dev dependencies.
COPY . .
RUN pnpm install --frozen-lockfile --prod=false

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["pnpm", "start:proxy"]
