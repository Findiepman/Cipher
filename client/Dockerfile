# syntax=docker/dockerfile:1
#
# Built from the REPO ROOT, not from client/ - one lockfile, three workspaces:
#
#   docker build -f client/Dockerfile .
#
# Produces a Caddy image with the built app baked in, so "the web tier" is one
# container rather than a static build shared between two through a volume.

FROM node:22-bookworm-slim AS build
WORKDIR /repo

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

# Manifests first for layer caching. server/'s are here only because `npm ci`
# installs the whole workspace from the single root lockfile, and its
# postinstall runs `prisma generate`, which needs the schema present.
COPY package.json package-lock.json ./
COPY packages/crypto/package.json packages/crypto/
COPY client/package.json client/
COPY server/package.json server/
COPY server/prisma server/prisma/
COPY server/prisma.config.ts server/

ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
RUN npm ci

COPY packages/crypto packages/crypto/
COPY client client/

# The production build is SAME-ORIGIN: blank means "use relative paths", so
# every request goes to whatever host served the page and Caddy proxies the
# API prefixes to Fastify. See client/src/lib/config.ts - this is what keeps
# the auth cookies first-party and removes CORS entirely.
ENV VITE_API_URL=""
ENV VITE_AUTH_MODE=cookie
ENV VITE_BACKEND=http
RUN npm run build --workspace @cipher/client


FROM caddy:2-alpine AS runtime
COPY --from=build /repo/client/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
EXPOSE 80
