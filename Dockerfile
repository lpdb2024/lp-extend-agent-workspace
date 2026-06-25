# ── Stage 1: build the Vue client (console + widget bundles) ──────────────────
FROM node:20-slim AS build
WORKDIR /app

# Install client deps and build (emits client/dist with index.html + widget.html)
COPY client/package*.json ./client/
RUN npm --prefix client ci
COPY client ./client
RUN npm --prefix client run build

# ── Stage 2: runtime — Express serves the built client + the /api backend ─────
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# PORT is provided by the host. Cloud Run injects $PORT (8080) and the server binds
# it (start:cloud runs tsx directly — no hardcoded port, no kill-port). For a local
# `docker run`, pass -e PORT=9400 (and optionally an --env-file). We default it to
# 8080 to match Cloud Run; the runtime env var always wins if set.
ENV PORT=8080
# Cobrowse room TLS: for plain-http local runs the server spins up a self-signed
# HTTPS server on 9443. On a managed-TLS host (Cloud Run), set COBROWSE_HTTPS_ORIGIN
# to your public https origin — that auto-disables the local :9443 server.
ENV COBROWSE_HTTPS_PORT=9443

# Server deps. tsx runs the TS entry at runtime, so it's required even in prod —
# install the full set INCLUDING devDependencies. (NODE_ENV=production makes `npm ci`
# skip dev deps by default, so force --include=dev or tsx is missing at runtime.)
COPY server/package*.json ./server/
RUN npm --prefix server ci --include=dev
COPY server ./server
# Static pages the server serves: landing (/) and the widget embed sample (/demo).
COPY demo ./demo
# Built client from stage 1 (the server serves ../client/dist relative to itself)
COPY --from=build /app/client/dist ./client/dist

EXPOSE 8080
# start:cloud = `tsx src/index.ts` — binds $PORT, no kill-port (fresh container).
CMD ["npm", "--prefix", "server", "run", "start:cloud"]
