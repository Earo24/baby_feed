# syntax=docker/dockerfile:1
FROM node:20-bookworm-slim AS deps
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY . .
RUN pnpm next build
RUN pnpm tsup src/server.ts --format cjs --platform node --target node20 --outDir dist --no-splitting --no-minify
RUN pnpm prune --prod

FROM node:20-bookworm-slim AS runner
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=9001
ENV DEPLOY_RUN_PORT=9001
ENV SQLITE_PATH=/app/data/baby-feed.sqlite
ENV NEXT_TELEMETRY_DISABLED=1
RUN groupadd --gid 10001 baby-feed \
  && useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin baby-feed
WORKDIR /app
COPY --from=builder --chown=10001:10001 /app/package.json ./package.json
RUN --mount=type=bind,from=builder,source=/app/node_modules,target=/tmp/runtime-dependencies \
  mkdir -p node_modules \
  && cp -a /tmp/runtime-dependencies/. ./node_modules \
  && chown -R 10001:10001 ./node_modules
COPY --from=builder --chown=10001:10001 /app/.next ./.next
COPY --from=builder --chown=10001:10001 /app/dist ./dist
COPY --from=builder --chown=10001:10001 /app/public ./public
RUN mkdir -p /app/data && chown 10001:10001 /app/data
USER 10001:10001
EXPOSE 9001
CMD ["node", "dist/server.js"]
