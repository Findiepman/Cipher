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

# The lockfile is generated on Windows, so it records only @rollup/rollup-win32-*
# and @esbuild/win32-x64. `npm ci` installs exactly what the lockfile lists and
# nothing else, so on Linux both packages arrive with no native binary and vite
# dies with "Cannot find module @rollup/rollup-linux-x64-gnu" - npm/cli#4828.
#
# Rather than hardcode versions that would silently rot the next time vite
# bumps rollup, ask the tree that npm ci just built what it actually installed,
# and derive the platform triple from the machine doing the building. Both
# packages demand an exact version match with their parent, so this has to be
# read rather than guessed.
RUN set -eux; \
    case "$(uname -m)" in \
      x86_64)  target=linux-x64 ;; \
      aarch64) target=linux-arm64 ;; \
      *) echo "unsupported build arch: $(uname -m)" >&2; exit 1 ;; \
    esac; \
    rollup_version="$(node -p "require('rollup/package.json').version")"; \
    esbuild_version="$(node -p "require('esbuild/package.json').version")"; \
    npm install --no-save --no-audit --no-fund \
      "@rollup/rollup-${target}-gnu@${rollup_version}" \
      "@esbuild/${target}@${esbuild_version}"

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
