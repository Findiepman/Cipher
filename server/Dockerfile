# syntax=docker/dockerfile:1
#
# Built from the REPO ROOT, not from server/:
#
#   docker build -f server/Dockerfile .
#
# There is one lockfile for the whole workspace, and `npm ci` is only
# reproducible against all of it. deploy/docker-compose.prod.yml sets the
# context accordingly.

FROM node:22-bookworm-slim AS build
WORKDIR /repo

# Prisma's tooling wants OpenSSL and it is not in -slim.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

# Manifests first, so this layer is cached until a dependency actually
# changes. The prisma schema comes with them because server/'s postinstall
# runs `prisma generate`, which needs the schema present *before* npm ci
# rather than after it.
COPY package.json package-lock.json ./
COPY packages/crypto/package.json packages/crypto/
COPY client/package.json client/
COPY server/package.json server/
COPY server/prisma server/prisma/
COPY server/prisma.config.ts server/

# prisma.config.ts resolves DATABASE_URL at load. Generating a client never
# connects to anything, but the config still has to parse, so a syntactically
# valid placeholder is enough. It is a build-stage value and is not carried
# into the final image.
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
RUN npm ci

# npm hoists workspace dependencies to the root when it can, so whether
# server/node_modules exists at all depends on version conflicts that differ
# between platforms - and `COPY` fails outright on a path that is not there.
# `prisma` currently lands in the workspace, but that is not a guarantee to
# build on.
RUN mkdir -p server/node_modules

COPY packages/crypto packages/crypto/
COPY server server/

# Regenerate the Prisma client now that the full server source - crucially
# tsconfig.json - is present.
#
# `npm ci` above already ran `prisma generate` as server/'s postinstall, but at
# that point only prisma/ and the manifests had been copied. The prisma-client
# generator reads tsconfig to decide how to write relative imports, and without
# one it emits `from './enums.ts'`. tsc passes those specifiers through
# untouched, so dist/ ends up importing .ts files that only exist as .js, and
# the server dies at startup with ERR_MODULE_NOT_FOUND - after migrations have
# already been applied.
#
# It is invisible locally because dev runs tsx and tests run vitest; both
# resolve .ts happily. Only `node dist/index.js` cares.
RUN npm run db:generate --workspace @cipher/server

RUN npm run build --workspace @cipher/server

# Prove the emitted output is actually loadable by node before shipping it.
# `tsc` succeeding says nothing about whether the specifiers it copied through
# resolve at runtime, which is exactly the gap that let the above ship.
RUN set -eux; \
    if grep -rEn --include="*.js" "from '[^']*\.ts'" server/dist/ ; then \
      echo "dist/ imports .ts specifiers - they will not resolve under node" >&2; \
      exit 1; \
    fi; \
    node --input-type=module -e "await import('/repo/server/dist/generated/prisma/client.js'); console.log('generated prisma client loads under node OK')"

# Everything the running server does not need, minus one exception: `prisma`
# is a runtime dependency here because the container applies migrations on
# start. See docker-entrypoint.sh.
RUN npm prune --omit=dev

# @node-rs/argon2 is a native module, and the lockfile is generated on Windows,
# so it lists only @node-rs/argon2-win32-x64-msvc. `npm ci` installs exactly
# what the lockfile says, which on Linux means argon2 arrives with no binding
# for this platform - npm/cli#4828, the same bug that breaks rollup in
# client/Dockerfile.
#
# This one is far more dangerous than the rollup case, because it fails at
# RUN time rather than build time and not immediately: the image builds, the
# server starts, and /health/ready passes because it only touches the database.
# The first symptom is that nobody can register or log in, since argon2 hashes
# the authVerifier on both paths.
#
# Two traps here, both of which have already bitten:
#
#   1. It must come AFTER `npm prune`, not before. Prune removes anything
#      absent from package.json, and --no-save deliberately keeps it out.
#   2. npm does NOT hoist @node-rs/argon2 to /repo/node_modules - it lives
#      in /repo/server/node_modules, so a bare require() from /repo cannot
#      see it. The version lookup resolves from /repo/server explicitly,
#      and the check runs from there. Installing at the root is still
#      correct: node walks up from server/node_modules and finds it.
RUN set -eux; \
    case "$(uname -m)" in \
      x86_64)  target=linux-x64 ;; \
      aarch64) target=linux-arm64 ;; \
      *) echo "unsupported build arch: $(uname -m)" >&2; exit 1 ;; \
    esac; \
    argon2_version="$(node -p "require(require.resolve('@node-rs/argon2/package.json', { paths: ['/repo/server'] })).version")"; \
    npm install --no-save --omit=dev --no-audit --no-fund \
      "@node-rs/argon2-${target}-gnu@${argon2_version}"; \
    cd /repo/server; \
    node -e "import('@node-rs/argon2').then(m => m.hash('probe')).then(() => console.log('argon2 native binding loads OK'), e => { console.error(e); process.exit(1); })"


FROM node:22-bookworm-slim AS runtime
WORKDIR /repo

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

COPY --from=build /repo/node_modules node_modules/
COPY --from=build /repo/package.json ./
COPY --from=build /repo/server/node_modules server/node_modules/
COPY --from=build /repo/server/package.json server/
COPY --from=build /repo/server/dist server/dist/
COPY --from=build /repo/server/prisma server/prisma/
COPY --from=build /repo/server/prisma.config.ts server/
COPY server/docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

WORKDIR /repo/server

# node's own unprivileged user, already in the base image. Nothing here needs
# to write to disk: mail goes to a relay and uploads do not exist.
USER node

EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "dist/index.js"]
