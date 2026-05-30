# syntax=docker/dockerfile:1.7
ARG NPM_REGISTRY=https://registry.npmmirror.com/

# ---- deps stage ----
FROM node:20-bookworm-slim AS deps
ARG NPM_REGISTRY
WORKDIR /app
RUN npm config set registry "$NPM_REGISTRY" && npm i -g pnpm@10.33.4
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm config set registry "$NPM_REGISTRY" && pnpm install --frozen-lockfile

# ---- build stage ----
FROM node:20-bookworm-slim AS build
ARG NPM_REGISTRY
WORKDIR /app
RUN npm config set registry "$NPM_REGISTRY" && npm i -g pnpm@10.33.4
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ---- runtime stage ----
FROM node:20-bookworm-slim AS runtime
ARG NPM_REGISTRY
WORKDIR /app
ENV NODE_ENV=production \
    PORT=13000 \
    HOSTNAME=0.0.0.0
RUN npm config set registry "$NPM_REGISTRY" && npm i -g pnpm@10.33.4
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/next.config.ts ./
EXPOSE 13000
CMD ["pnpm", "start", "-p", "13000", "-H", "0.0.0.0"]
