# Notive single image. Web/API and Worker share this image; their
# entrypoints diverge at container start (operations section 4.1).
#
#   web:    CMD ["pnpm", "--filter", "@notive/web", "start"]
#   worker: CMD ["pnpm", "--filter", "@notive/worker", "start"]
#
# Phase B scaffolding only. Do not deploy this yet. The CMD line is
# left unset so the orchestrator (or docker-compose) selects the
# correct entrypoint per container.

# ---- deps stage ---------------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# Copy workspace files needed by pnpm install.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY packages/auth/package.json ./packages/auth/
COPY packages/permissions/package.json ./packages/permissions/
COPY packages/mail/package.json ./packages/mail/
COPY packages/redis/package.json ./packages/redis/
COPY tests/unit/package.json ./tests/unit/

RUN pnpm install --frozen-lockfile || pnpm install

# ---- build stage --------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/apps/worker/node_modules ./apps/worker/node_modules
COPY . .

# Build web (Next.js) and worker (tsc).
RUN pnpm --filter @notive/web build \
 && pnpm --filter @notive/worker build

# ---- runtime stage ------------------------------------------------------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

COPY --from=build /app /app

# No CMD here. The orchestrator picks one of:
#   pnpm --filter @notive/web start
#   pnpm --filter @notive/worker start
EXPOSE 3000
