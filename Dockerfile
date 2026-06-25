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
# PORT: respected from the environment. Cloud Run / most PaaS inject $PORT and the
# server binds it (start:cloud runs tsx directly, no hardcoded port, no kill-port).
# Locally `docker run` defaults this to 9400 unless you pass -e PORT / --env-file.
ENV PORT=9400
# Cobrowse room TLS: for plain-http local runs the server spins up a self-signed
# HTTPS server on 9443. On a managed-TLS host, set COBROWSE_HTTPS_ORIGIN (in the
# env file) to your public https origin — that auto-disables the local :9443 server.
ENV COBROWSE_HTTPS_PORT=9443

# Server deps. tsx runs the TS entry at runtime, so it's required even in prod —
# install the full dependency set (tsx lives in devDependencies).
COPY server/package*.json ./server/
RUN npm --prefix server ci
COPY server ./server
# Built client from stage 1 (the server serves ../client/dist relative to itself)
COPY --from=build /app/client/dist ./client/dist

EXPOSE 9400 9443
# start:cloud = `tsx src/index.ts` — binds $PORT, no kill-port (fresh container).
CMD ["npm", "--prefix", "server", "run", "start:cloud"]
