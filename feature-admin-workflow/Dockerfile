# syntax=docker/dockerfile:1.7

FROM node:22.23.1-bookworm-slim@sha256:8607a9064d4a571140998ae9e52a3b3fcf9cff361d04642d5971e6cd76d39e27 AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update \
  && apt-get upgrade --yes \
  && apt-get install --yes --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@10.11.0 --activate

WORKDIR /app

FROM base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS production-dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --no-optional --frozen-lockfile

COPY prisma/schema.prisma ./prisma/schema.prisma
RUN pnpm exec prisma generate --schema prisma/schema.prisma

FROM base AS builder

ARG GIT_COMMIT_SHA
ARG NEXT_PUBLIC_AMAP_JS_KEY
ARG NEXT_PUBLIC_AMAP_SECURITY_JS_CODE

ENV NEXT_PUBLIC_AMAP_JS_KEY=$NEXT_PUBLIC_AMAP_JS_KEY
ENV NEXT_PUBLIC_AMAP_SECURITY_JS_CODE=$NEXT_PUBLIC_AMAP_SECURITY_JS_CODE
ENV NEXT_OUTPUT_STANDALONE=true

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

RUN find prisma/migrations -type f \( -name 'migration.sql' -o -name 'rollback.sql' \) \
      -exec sed -i 's/\r$//' {} + \
  && ! grep --recursive --files-with-matches --binary-files=text \
      --include='migration.sql' --include='rollback.sql' \
      "$(printf '\r')" prisma/migrations \
  && printf '%s  %s\n' \
      'ab2fd94d6d6549ee4dfcff51c744bcc76390fdff26fd26d89b928637e144759c' \
      'prisma/migrations/20260816120000_extend_dispatch_event_outbox_types/migration.sql' \
    | sha256sum --check --strict \
  && test -n "$GIT_COMMIT_SHA" \
  && test -n "$NEXT_PUBLIC_AMAP_JS_KEY" \
  && test -n "$NEXT_PUBLIC_AMAP_SECURITY_JS_CODE" \
  && mkdir -p public \
  && pnpm exec prisma generate \
  && pnpm build

FROM builder AS standalone-artifacts

RUN rm -rf /app/.next/standalone/node_modules

FROM gcr.io/distroless/nodejs22-debian13:nonroot@sha256:4e4fb0ce55fd73901600796ef079a9490369d2515d7da31633a91608c82ca13b AS runner

ARG GIT_COMMIT_SHA

LABEL org.opencontainers.image.revision=$GIT_COMMIT_SHA

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV PATH=/nodejs/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

WORKDIR /app

ENTRYPOINT []

COPY --from=standalone-artifacts --chown=65532:65532 /app/.next/standalone ./
COPY --from=production-dependencies --chown=65532:65532 /app/node_modules ./node_modules
COPY --from=builder --chown=65532:65532 /app/.next/static ./.next/static
COPY --from=builder --chown=65532:65532 /app/public ./public
COPY --from=builder --chown=65532:65532 /app/package.json ./package.json
COPY --from=builder --chown=65532:65532 /app/prisma ./prisma
COPY --from=builder --chown=65532:65532 /app/scripts/dispatch-event-worker.mjs ./scripts/dispatch-event-worker.mjs

USER 65532:65532

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v2/health').then(response=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "server.js"]
