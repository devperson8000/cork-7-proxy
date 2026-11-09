# Build Scramjet's WASM rewriter and the fixed Cork7 player.
FROM node:24-bookworm-slim AS build

WORKDIR /app
ENV PATH="/root/.cargo/bin:${PATH}"
ENV VITE_WISP_URL="wss://p01--cork7--yf5q7tyyggsr.code.run/wisp/"

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates curl git build-essential pkg-config binaryen \
    && rm -rf /var/lib/apt/lists/*

RUN npm install --global pnpm@12.17.0

# Scramjet's rewriter build requires Rust nightly, wasm-bindgen, wasm-opt and
# the wasm-snip fork referenced by the upstream build instructions.
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
RUN rustup toolchain install nightly --profile minimal --component rust-src \
    && rustup target add wasm32-unknown-unknown --toolchain nightly
RUN cargo install wasm-bindgen-cli --version 0.2.105 --locked
RUN cargo install --git https://github.com/r58Playz/wasm-snip

COPY . .
RUN pnpm install --frozen-lockfile --prod=false

# Build the WebAssembly rewriter before the JS bundles.
RUN cd packages/core && RELEASE=1 pnpm run rewriter:build
RUN pnpm --filter @mercuryworkshop/scramjet build
RUN pnpm --filter @mercuryworkshop/scramjet-demo build

# Small runtime image: only the Wisp server, built web client and installed
# runtime module tree are copied from the build stage.
FROM node:24-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server ./server
COPY --from=build /app/packages/demo/dist ./packages/demo/dist

EXPOSE 3000
CMD ["node", "server/wisp-server.mjs"]
