import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { authRouter } from './routes/auth.js';
import { messagingRouter } from './routes/messaging.js';
import { secureFormRouter } from './routes/secure-form.js';
import { cobrowseRouter } from './routes/cobrowse.js';
import { llmRouter } from './routes/llm.js';
import { handleCobrowseUpgrade } from './lp/cobrowse-ws-proxy.js';
import { makeSelfSignedCert } from './lp/self-cert.js';

const app = express();
// Default 8787 in dev (Vite serves the UI on 9400 and proxies /api here). In the
// single-port prod build the server serves the SPA itself — run it on 9400 so the
// SSO callback origin matches the registered http://localhost:9400/callback.
const PORT = Number(process.env.PORT ?? 8787);

// Skip JSON parsing for the cobrowse room proxy — it forwards raw request bodies
// (CometD/XHR) verbatim, so the asset route does its own raw body capture.
app.use((req, res, next) => {
  if (/^\/api\/cobrowse\/[^/]+\/asset\//.test(req.path)) return next();
  return express.json({ limit: '2mb' })(req, res, next);
});
app.use(cookieParser());

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'agent-chat-widget' }));

app.use('/api/auth', authRouter);
// Cobrowse FIRST: its proxy routes (/room, /asset/*) must bypass the session guard,
// but messagingRouter/secureFormRouter apply requireSession to ALL /api/* — so they'd
// 401 the cross-origin room iframe before it reached here. Mounting cobrowse first lets
// it handle (or open-auth) its own paths, then call next() for everything else.
app.use('/api', cobrowseRouter);
app.use('/api', messagingRouter);
app.use('/api', secureFormRouter);
app.use('/api', llmRouter);

// Serve the built client in production (vite build -> ../client/dist). Two SPA
// entries: the full console (index.html) and the embeddable widget (widget.html).
const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(here, '../../client/dist');

// Developer landing page (static). Showcases the full console + the embeddable
// widget with HTML mockups and a clone/get-started CTA. This is the root surface.
const landingPage = path.resolve(here, '../../demo/landing.html');
app.get('/', (_req, res) => res.sendFile(landingPage));

// Sample host page: a stand-in CRM that demonstrates embedding the widget via an
// <iframe src="/widget">. Not the widget itself — shows how a developer embeds it.
const demoPage = path.resolve(here, '../../demo/embed.html');
app.get('/demo', (_req, res) => res.sendFile(demoPage));

app.use(express.static(clientDist));
app.get('*', (req, res) => {
  // Route map:
  //   /widget*           → the embeddable widget bundle (+ its SSO popup callback)
  //   /agent-workspace*  → the full console SPA
  //   /callback          → the console's SSO return (console SPA handles it)
  //   everything else    → console SPA fallback
  const entry = /^\/widget(\/|$)/.test(req.path) ? 'widget.html' : 'index.html';
  res.sendFile(path.join(clientDist, entry));
});

// Bridge the cobrowse room's live screen WebSocket through our authenticated jar.
const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
  try {
    if (!handleCobrowseUpgrade(req, socket, head)) socket.destroy();
  } catch (err) {
    console.warn('[upgrade] error:', err instanceof Error ? err.message : err);
    socket.destroy();
  }
};

const httpServer = http.createServer(app);
httpServer.on('upgrade', onUpgrade);
httpServer.listen(PORT, () => {
  console.log(`[agent-chat-widget] server listening on http://localhost:${PORT}`);
});

// HTTPS listener for the cobrowse room proxy. Synchronite forces https/wss to our
// origin, so the room must be served over TLS. The client points its cobrowse
// iframe/popup at COBROWSE_HTTPS_ORIGIN (default https://localhost:<HTTPS_PORT>).
//
// On a managed HTTPS host (Cloud Run, a tunnel, a reverse proxy) TLS is terminated
// upstream and the whole app is already reachable over https — set
// COBROWSE_HTTPS_ORIGIN to that public origin and we DON'T spin up the local
// self-signed :9443 server (it's only needed for plain-http localhost dev).
const hasManagedTls = !!process.env.COBROWSE_HTTPS_ORIGIN;
const HTTPS_PORT = hasManagedTls ? 0 : Number(process.env.COBROWSE_HTTPS_PORT ?? 9443);
if (hasManagedTls) {
  console.log(`[agent-chat-widget] cobrowse room origin: ${process.env.COBROWSE_HTTPS_ORIGIN} (managed TLS; local :9443 disabled)`);
}
if (HTTPS_PORT) {
  makeSelfSignedCert()
    .then(({ key, cert }) => {
      const httpsServer = https.createServer({ key, cert }, app);
      httpsServer.on('upgrade', onUpgrade);
      httpsServer.listen(HTTPS_PORT, () => {
        console.log(`[agent-chat-widget] HTTPS (cobrowse room) on https://localhost:${HTTPS_PORT}`);
      });
    })
    .catch((err) => console.warn('[agent-chat-widget] HTTPS disabled:', err instanceof Error ? err.message : err));
}
