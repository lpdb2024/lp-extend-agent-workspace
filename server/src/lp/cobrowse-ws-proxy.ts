import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import { getCobrowse } from './cobrowse.js';
import { dbg } from './debug.js';

/**
 * WebSocket proxy for the cobrowse room's live screen stream.
 *
 * The synchronite room JS opens a WS straight to the cobrowse host. Because the
 * proxied room runs on our origin, we rewrite its tenantHost to point back here,
 * then bridge that browser WS to a server-side WS to the REAL cobrowse host —
 * carrying the session's authenticated cookies (which the browser doesn't have).
 *
 * URL shape: /api/cobrowse/:key/asset/<original cobrowse ws path>
 */

const wss = new WebSocketServer({ noServer: true });

const PATH_RE = /^\/api\/cobrowse\/([^/]+)\/asset(\/.*)?$/;

export function handleCobrowseUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
  const url = req.url ?? '';
  const m = PATH_RE.exec(url.split('?')[0]);
  if (!m) return false; // not ours — let other handlers (Vite HMR etc.) deal with it

  const key = m[1];
  const session = getCobrowse(key);
  if (!session) {
    socket.destroy();
    return true;
  }

  // Reconstruct the upstream cobrowse URL: everything after /asset + query.
  const afterAsset = url.split(`/cobrowse/${key}/asset`)[1] || '/';
  const upstreamUrl = `wss://${session.cobrowseDomain()}${afterAsset.startsWith('/') ? '' : '/'}${afterAsset}`;

  wss.handleUpgrade(req, socket, head, (browserWs) => {
    bridge(browserWs, upstreamUrl, session.cookieHeaderPublic(), session.cobrowseDomain());
  });
  return true;
}

function bridge(browserWs: WebSocket, upstreamUrl: string, cookie: string, host: string): void {
  dbg('[cobrowse-ws] bridging →', upstreamUrl);
  const upstream = new WebSocket(upstreamUrl, {
    headers: { Cookie: cookie, Origin: `https://${host}`, 'User-Agent': 'Mozilla/5.0' },
  });

  const pending: Array<string | Buffer | ArrayBuffer> = [];
  let upstreamOpen = false;

  upstream.on('open', () => {
    upstreamOpen = true;
    for (const m of pending) upstream.send(m);
    pending.length = 0;
  });

  // Browser → upstream
  browserWs.on('message', (data: Buffer, isBinary: boolean) => {
    const payload = isBinary ? data : data.toString();
    if (upstreamOpen) upstream.send(payload);
    else pending.push(payload);
  });
  // Upstream → browser
  upstream.on('message', (data: Buffer, isBinary: boolean) => {
    if (browserWs.readyState === WebSocket.OPEN) browserWs.send(isBinary ? data : data.toString());
  });

  const closeBoth = (who: string) => () => {
    dbg('[cobrowse-ws] close from', who);
    if (browserWs.readyState === WebSocket.OPEN) browserWs.close();
    if (upstream.readyState === WebSocket.OPEN) upstream.close();
  };
  browserWs.on('close', closeBoth('browser'));
  upstream.on('close', closeBoth('upstream'));
  browserWs.on('error', (e) => console.warn('[cobrowse-ws] browser err:', e.message));
  upstream.on('error', (e) => {
    console.warn('[cobrowse-ws] upstream err:', e.message);
    if (browserWs.readyState === WebSocket.OPEN) browserWs.close();
  });
}
