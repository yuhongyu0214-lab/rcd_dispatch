# syntax=docker/dockerfile:1.7

FROM node:22.14.0-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1

RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

WORKDIR /app

FROM base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder

ARG GIT_COMMIT_SHA
ARG NEXT_PUBLIC_AMAP_JS_KEY
ARG NEXT_PUBLIC_AMAP_SECURITY_JS_CODE

ENV NEXT_PUBLIC_AMAP_JS_KEY=$NEXT_PUBLIC_AMAP_JS_KEY
ENV NEXT_PUBLIC_AMAP_SECURITY_JS_CODE=$NEXT_PUBLIC_AMAP_SECURITY_JS_CODE
ENV NEXT_OUTPUT_STANDALONE=true

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

RUN test -n "$GIT_COMMIT_SHA" \
  && test -n "$NEXT_PUBLIC_AMAP_JS_KEY" \
  && test -n "$NEXT_PUBLIC_AMAP_SECURITY_JS_CODE" \
  && mkdir -p public \
  && pnpm exec prisma generate \
  && pnpm build

FROM node:22.14.0-bookworm-slim AS runner

ARG GIT_COMMIT_SHA

LABEL org.opencontainers.image.revision=$GIT_COMMIT_SHA

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

WORKDIR /app

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/scripts/dispatch-event-worker.mjs ./scripts/dispatch-event-worker.mjs

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v2/health').then(response=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
