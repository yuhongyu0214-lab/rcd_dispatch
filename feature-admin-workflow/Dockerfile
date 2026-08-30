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

RUN test -n "$GIT_COMMIT_SHA" \
  && test -n "$NEXT_PUBLIC_AMAP_JS_KEY" \
  && test -n "$NEXT_PUBLIC_AMAP_SECURITY_JS_CODE" \
  && mkdir -p public \
  && pnpm exec prisma generate \
  && pnpm build

FROM builder AS standalone-artifacts

RUN rm -rf /app/.next/standalone/node_modules

FROM node:22.23.1-bookworm-slim@sha256:8607a9064d4a571140998ae9e52a3b3fcf9cff361d04642d5971e6cd76d39e27 AS runner

ARG GIT_COMMIT_SHA

LABEL org.opencontainers.image.revision=$GIT_COMMIT_SHA

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

WORKDIR /app

RUN apt-get update \
  && apt-get upgrade --yes \
  && apt-get install --yes --no-install-recommends ca-certificates openssl \
  && dpkg --compare-versions "$(dpkg-query --show --showformat='${Version}' libgnutls30)" ge '3.7.9-2+deb12u7' \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs \
  && rm -rf /usr/local/lib/node_modules/npm \
    /usr/local/lib/node_modules/corepack \
    /opt/yarn-* \
  && rm -f /usr/local/bin/npm \
    /usr/local/bin/npx \
    /usr/local/bin/corepack \
    /usr/local/bin/pnpm \
    /usr/local/bin/pnpx \
    /usr/local/bin/yarn \
    /usr/local/bin/yarnpkg

COPY --from=standalone-artifacts --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=production-dependencies --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/scripts/dispatch-event-worker.mjs ./scripts/dispatch-event-worker.mjs

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v2/health').then(response=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
