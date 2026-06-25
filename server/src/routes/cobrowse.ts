import { Router, type Request, type Response, raw as rawBody } from 'express';
import type { AgentSession } from '../lp/connection.js';
import { requireSession } from './auth.js';
import { CobrowseSession, putCobrowse, getCobrowse, dropCobrowse } from '../lp/cobrowse.js';
import { sendCobrowseInvite, sendCobrowseAcceptJoin, sendCobrowseCancel } from '../lp/cobrowse-invite.js';
import { dbg } from '../lp/debug.js';

export const cobrowseRouter = Router();

type Req = Request & { session: AgentSession };

// The room-proxy routes (/room, /asset/*) are loaded by the cobrowse iframe from a
// DIFFERENT origin (the HTTPS port), so they can't carry the agent's session cookie.
// They're authorized instead by the unguessable session :key in the URL, which maps
// to the server-side authenticated jar. Everything else still requires the session.
// Routes this router owns (so it doesn't run requireSession on OTHER routers' paths
// like /conversations/.../messages — those fall through untouched to next()).
const OWNED = /^\/(conversations\/[^/]+\/cobrowse|cobrowse\/[^/]+\/(events|room|asset|stop))/;
// The room-proxy routes are loaded by the iframe from a DIFFERENT origin (HTTPS port)
// and can't carry the session cookie — they're authorized by the unguessable :key +
// the server-side jar, NOT requireSession.
const OPEN = /^\/cobrowse\/[^/]+\/(room|asset(\/|$))/;
cobrowseRouter.use((req, res, next) => {
  if (!OWNED.test(req.path)) return next(); // not ours → let other routers handle it
  if (OPEN.test(req.path)) return next(); // proxy route → no session cookie expected
  return requireSession(req, res, next); // start / events / stop → require the agent session
});

/**
 * Goal 4 — start a server-side cobrowse session.
 *
 * Everything is derived from the SDK conversation (no client prompt):
 *  - consumerId    : conversation.consumer.id
 *  - serviceId     : `${consumerId}#${conversationId}` (the format LP cobrowse expects)
 *  - shark IDs     : conversation.context.sessionId / .visitorId
 *  - skillId       : conversation.skill.skillId
 * Body only optionally overrides `mode` ('cobrowse' | 'voice-call' | 'video-call').
 */
// Conversations with a cobrowse start in flight — synchronous guard so two near-
// simultaneous POSTs (panel re-render / SSE reconnect) don't both run createSN and
// race each other ("call has ended"). Cleared once the session is registered or fails.
const startingConvs = new Set<string>();

cobrowseRouter.post('/conversations/:id/cobrowse', async (req: Request, res: Response) => {
  const session = (req as Req).session;
  const mode = (req.body?.mode ?? 'cobrowse') as string;
  const convKey = `${session.accountId}:${req.params.id}`;
  if (startingConvs.has(convKey)) {
    return res.status(409).json({ error: 'cobrowse already starting for this conversation' });
  }
  startingConvs.add(convKey);
  try {
    const conv = session.getConversation(req.params.id);
    const c = conv.consumer as { id?: unknown; userId?: unknown; agentId?: unknown } | null;
    const consumerId = c ? String(c.id ?? c.userId ?? c.agentId ?? '') || null : null;
    if (!consumerId) {
      // Surface the actual participant shape so we can see which field holds the id.
      console.warn('[cobrowse] no consumer id; consumer participant =', JSON.stringify(conv.consumer));
      return res.status(409).json({
        error: 'Could not read consumer id from conversation.',
        consumerShape: conv.consumer ?? null,
      });
    }

    const ctx = (conv.context ?? {}) as Record<string, unknown>;
    const conversationId = req.params.id;
    const serviceId = `${consumerId}#${conversationId}`;
    // skillId is required for calls — the /call room renders `config.skillId` from the
    // ticket; an empty value produces malformed JS (`skillId:\n}`) that aborts the room.
    const skillId =
      (conv.skill?.skillId ? String(conv.skill.skillId) : undefined) ??
      session.conversationMeta(conversationId).skillId ??
      undefined;
    dbg('[cobrowse] start mode=', mode, 'skillId=', skillId);
    const sharkSessionId = typeof ctx.sessionId === 'string' ? ctx.sessionId : undefined;
    const sharkVisitorId = typeof ctx.visitorId === 'string' ? ctx.visitorId : undefined;

    const accessToken = await session.connection.getToken();
    const cb = new CobrowseSession({
      brandId: session.accountId,
      accessToken,
      agentId: (session.connection.agentId as string) ?? session.agentId,
      agentName: session.displayName, // nickname/fullName — the call room's `username`
      conversationId,
      consumerId,
      serviceId,
      skillId,
      mode,
      sharkSessionId,
      sharkVisitorId,
    });

    // Idempotency: the session key is deterministic (brand_agent_conversation). If a
    // live session already exists for this conversation (double POST from a re-render
    // / SSE reconnect), reuse it — starting a second createSN races the first and
    // tears the call down ("call has ended"). Tear down only if aborted.
    const existing = getCobrowse(cb.key);
    if (existing && !existing.aborted) {
      dbg('[cobrowse] reusing existing session', cb.key);
      return res.json({ ok: true, sessionKey: existing.key });
    }
    if (existing) dropCobrowse(existing.key);
    putCobrowse(cb);

    // Respond immediately so the client can open the SSE stream; the session +
    // invite run async and report via SSE (events are buffered/replayed so none
    // are missed regardless of when the SSE connects).
    res.json({ ok: true, sessionKey: cb.key });

    // ORDER MATTERS: the agent's cobrowse availability must be registered with the
    // cobrowse server (handshake → subscribe → connect → createSN, all inside
    // cb.start()) BEFORE we send the consumer the INVITE. If the invite lands first,
    // LP has nowhere to route the consumer's accept and the prompt is dropped.
    void (async () => {
      try {
        await cb.start(); // resolves after createSN; emits 'connected'
      } catch {
        return; // start() already emitted an error event
      }

      // The UMS dialog `mode` is what the CONSUMER widget validates against its
      // acceptedCoBrowseModes = ['view','shared','follow','VIDEO_CALL','VOICE_CALL']
      // (lpUnifiedWindow CoBrowseManager). 'COBROWSE' is the channelType, NOT an
      // accepted mode — sending it means the consumer receives the dialog but never
      // renders the invite widget. Screen-share cobrowse must use a permission level
      // ('view' = read-only, the standard default); calls keep VIDEO_CALL/VOICE_CALL.
      const umsMode =
        mode === 'cobrowse' ? 'view' : mode.toUpperCase().replace('-', '_'); // video-call -> VIDEO_CALL
      try {
        const invite = await sendCobrowseInvite(session.connection, {
          conversationId,
          consumerId,
          agentUserId: (session.connection.agentId as string) ?? session.agentId,
          brandId: session.accountId,
          serviceId,
          mode: umsMode,
          skillId,
        });
        cb.emit('event', { type: 'inviteSent', dialogId: invite.dialogId, callLink: invite.callLink });

        // Remember the dialog so a stop/cancel can close it in UMS (required to
        // re-invite). The cancel only fires while the invite is still pending.
        cb.inviteDialogId = invite.dialogId;
        cb.inviteMode = umsMode;
        cb.onStop = async () => {
          if (cb.accepted || !cb.inviteDialogId) return; // already active → nothing to cancel
          await sendCobrowseCancel(session.connection, {
            conversationId,
            dialogId: cb.inviteDialogId,
            mode: cb.inviteMode ?? umsMode,
          });
        };

        // When the consumer accepts (CometD startSession push → canStartCall), send the
        // ACCEPTED + JOINED dialog updates so the call/cobrowse session can proceed.
        let acceptSent = false;
        cb.on('event', (e: unknown) => {
          const ev = e as { type?: string };
          if (ev?.type !== 'canStartCall' || acceptSent) return;
          acceptSent = true;
          cb.accepted = true; // don't cancel an accepted dialog on stop
          sendCobrowseAcceptJoin(session.connection, {
            conversationId,
            dialogId: invite.dialogId,
            mode: umsMode,
          }).catch((err) =>
            console.warn('[cobrowse] acceptJoin failed:', err instanceof Error ? err.message : err),
          );
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[cobrowse] invite send failed:', msg);
        cb.emit('event', { type: 'inviteFailed', error: msg });
      }
    })();
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  } finally {
    startingConvs.delete(convKey);
  }
});

/** SSE stream of cobrowse events for a session key. */
cobrowseRouter.get('/cobrowse/:key/events', (req: Request, res: Response) => {
  const cb = getCobrowse(req.params.key);
  if (!cb) return res.status(404).json({ error: 'cobrowse session not found' });

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const onEvent = (e: unknown) => {
    res.write(`event: cobrowse\n`);
    res.write(`data: ${JSON.stringify(e)}\n\n`);
  };
  // Replay any events that fired before this SSE connected (handshake, invite…).
  cb.replay(onEvent);
  cb.on('event', onEvent);
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(keepAlive);
    cb.off('event', onEvent);
  });
});

/**
 * Server-side proxy of the agent cobrowse room.
 *
 * The room authenticates against the agent's LE *browser* session, which our
 * localhost browser doesn't have — but our SERVER jar IS authenticated (it passed
 * /oauth → /login/callback). So we fetch the room with the server jar and stream it
 * to the browser, rewriting absolute cobrowse-host URLs back through this proxy.
 */
const COBROWSE_HOST_RE = /https?:\/\/[\w.-]*cobrowse\.liveperson\.net/gi;
const COBROWSE_BARE_RE = /[\w-]+(?:\.[\w-]+)*\.cobrowse\.liveperson\.net/gi;

/**
 * Replace cobrowse-host references with our proxy.
 *  - Absolute http(s) URLs → /api/cobrowse/:key/asset (relative, same-origin).
 *  - Bare hostnames (e.g. synchronite's `tenantHost`) → <ourHost>/api/cobrowse/:key/asset
 *    so the room's WebSocket (wss://<that>/...) is dialed back at us and bridged.
 */
function rewriteUrls(text: string, key: string, host: string): string {
  return text
    .replace(COBROWSE_HOST_RE, `/api/cobrowse/${key}/asset`)
    .replace(COBROWSE_BARE_RE, `${host}/api/cobrowse/${key}/asset`);
}

/** HTML: rewrite URLs, fix root-relative asset paths, and neutralise the
 * document.domain games (which throw on our localhost host and halt the page). */
function rewriteHtml(html: string, key: string, host: string): string {
  const prefix = `/api/cobrowse/${key}/asset`;
  let out = rewriteUrls(html, key, host);

  // Rewrite src/href explicitly rather than relying on <base> (the iframe src
  // resolved against the /room document URL, dropping the /asset/ segment → 404).
  //   - root-relative: src="/js/…"  → prefix + path
  //   - bare-relative: src="proxylessFrame?…", "../images/…" → prefix/ + value
  // Skip absolute URLs (http, //) and paths we've already proxied (/api/cobrowse/).
  out = out.replace(
    /\b(src|href)=(['"])(?!https?:|\/\/|#|data:|javascript:)([^'"]*)\2/gi,
    (_m, attr: string, q: string, val: string) => {
      if (val.startsWith('/api/cobrowse/')) return `${attr}=${q}${val}${q}`;
      // Normalise ../ and leading ./, then attach under the proxy prefix.
      const clean = val.replace(/^\.\//, '').replace(/^\.\.\//, '');
      const path = clean.startsWith('/') ? clean : `/${clean}`;
      return `${attr}=${q}${prefix}${path}${q}`;
    },
  );
  out = out.replace(/url\((['"]?)\/(?!\/|api\/cobrowse\/)/gi, `url($1${prefix}/`);

  // The synchronite shell does `document.domain = …`, which throws on our host
  // ("undefined.localhost is not a suffix of localhost") and aborts the page.
  // Rather than strip (which may break dependent flow), make document.domain a
  // tolerant no-op setter via a shim injected at the very top of <head>, so the
  // room's assignment silently succeeds. Everything is same-origin via the proxy.
  const shim = `<script>try{Object.defineProperty(document,'domain',{configurable:true,set:function(){},get:function(){return location.hostname;}});}catch(e){}</script>`;
  if (/<head[^>]*>/i.test(out)) out = out.replace(/<head[^>]*>/i, (m) => `${m}${shim}`);
  else out = shim + out;

  return out;
}

/** The room entry point — serves the authenticated /proxyless HTML. */
cobrowseRouter.get('/cobrowse/:key/room', async (req: Request, res: Response) => {
  const cb = getCobrowse(req.params.key);
  if (!cb) return res.status(404).send('cobrowse session not found');
  if (!cb.roomUrl) return res.status(409).send('room not ready (consumer has not accepted yet)');
  const host = req.get('host') ?? 'localhost:9400';
  try {
    const r = await cb.proxyRoomRequest(cb.roomUrl);
    dbg(`[cobrowse] room GET ${r.status} ${r.contentType} ${r.body.length}b url=${cb.roomUrl.slice(0, 90)}`);
    if (r.contentType?.includes('text/html')) {
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.send(rewriteHtml(r.body.toString('utf8'), req.params.key, host));
    }
    if (r.contentType) res.set('Content-Type', r.contentType);
    res.status(r.status).send(r.body);
  } catch (err) {
    res.status(502).send(`room proxy error: ${err instanceof Error ? err.message : String(err)}`);
  }
});

/** Asset/XHR/CometD passthrough for everything the room page requests.
 * `rawBody` captures any POST body as a Buffer (the global express.json would
 * otherwise consume CometD/JSON bodies into objects we can't forward verbatim). */
cobrowseRouter.all('/cobrowse/:key/asset/*', rawBody({ type: () => true, limit: '5mb' }), async (req: Request, res: Response) => {
  const cb = getCobrowse(req.params.key);
  if (!cb) return res.status(404).send('cobrowse session not found');
  // Everything after /asset is the original cobrowse-host path + query.
  const tail = req.originalUrl.split(`/cobrowse/${req.params.key}/asset`)[1] ?? '/';
  const body = Buffer.isBuffer(req.body) && req.body.length ? (req.body as Buffer) : undefined;
  const host = req.get('host') ?? 'localhost:9400';
  try {
    const r = await cb.proxyRoomRequest(tail, {
      method: req.method,
      body,
      contentType: req.get('content-type') ?? undefined,
    });
    dbg(`[cobrowse] asset ${req.method} ${r.status} ${r.contentType ?? ''} ${tail.slice(0, 140)}`);
    if (r.location) {
      const loc = r.location.replace(/https?:\/\/[\w.-]*cobrowse\.liveperson\.net/i, `/api/cobrowse/${req.params.key}/asset`);
      return res.redirect(r.status, loc);
    }
    if (r.contentType?.includes('text/html')) {
      res.set('Content-Type', r.contentType);
      return res.send(rewriteHtml(r.body.toString('utf8'), req.params.key, host));
    }
    if (r.contentType && /javascript|json/.test(r.contentType)) {
      // Rewrite cobrowse host refs (incl. bare tenantHost) inside JS/JSON.
      res.set('Content-Type', r.contentType);
      return res.send(rewriteUrls(r.body.toString('utf8'), req.params.key, host));
    }
    if (r.contentType) res.set('Content-Type', r.contentType);
    res.status(r.status).send(r.body);
  } catch (err) {
    res.status(502).send(`asset proxy error: ${err instanceof Error ? err.message : String(err)}`);
  }
});

cobrowseRouter.post('/cobrowse/:key/stop', (req: Request, res: Response) => {
  dropCobrowse(req.params.key);
  res.json({ ok: true });
});
