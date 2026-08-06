FROM node:20-bookworm AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.32.0 --activate

FROM base AS builder
# FORCE COMPLETE REBUILD: 2026-03-26T11:35:00
ENV CACHE_BUST=2026-03-26T11:35:00
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# Copy ALL package.json files for installation
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/

# COPY ALL FOLDERS BEFORE INSTALL
COPY apps/api ./apps/api
COPY apps/web ./apps/web
COPY packages/shared ./packages/shared

RUN pnpm install --frozen-lockfile

# Generate Prisma and build
RUN pnpm --filter api exec prisma generate
RUN pnpm --filter api build
# Accept build args so Next.js bakes them into the browser bundle
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_GEMINI_API_KEY
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_GEMINI_API_KEY=$NEXT_PUBLIC_GEMINI_API_KEY
RUN pnpm --filter web build

# FIX: Fail fast if build produced no output — prevents broken images
RUN test -f apps/api/dist/server.js || (echo "FATAL: dist/server.js not found after build!" && exit 1)

FROM base AS runner
COPY --from=builder /app ./

# Switch start command based on SERVICE_TYPE (Cloud Run uses --command override, this is fallback)
# DIRECT_URL fallback ensures Prisma never crashes on missing env var
CMD ["sh", "-c", "export DIRECT_URL=${DIRECT_URL:-$DATABASE_URL}; if [ \"$SERVICE_TYPE\" = \"web\" ]; then cd apps/web && pnpm start -- -p ${PORT:-3000}; else cd apps/api && pnpm exec prisma migrate deploy && pnpm start:prod; fi"]
