# The worker's image, built from the repo root:
#   docker build -f apps/worker/Dockerfile .
# Only the worker and the shared package are installed; the mobile app's
# dependencies never enter the image.
FROM node:22-bookworm-slim AS build
RUN npm install -g pnpm@11.5.2
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --filter @barber/worker...
COPY packages/shared packages/shared
COPY apps/worker apps/worker
RUN pnpm --filter @barber/worker run build
# Drops the dev dependencies the build needed; CI lets pnpm replace
# node_modules without asking for a TTY.
RUN CI=true pnpm install --frozen-lockfile --filter @barber/worker... --prod

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
WORKDIR /app/apps/worker
EXPOSE 3000
CMD ["node", "dist/main"]
