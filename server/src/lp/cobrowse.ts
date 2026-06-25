import { EventEmitter } from 'node:events';
import https from 'node:https';
import http from 'node:http';
import { dbg } from './debug.js';

/**
 * Goal 4 — Cobrowse, server-side.
 *
 * Transport: HTTP long-polling against `{brandId}.{region}.cobrowse.liveperson.net`
 * with a PERSISTENT COOKIE JAR. The cobrowse sync server is node-sticky
 * (`cobrowsenode`, `SYNCHRONITEID` cookies) — every call in a session MUST reuse
 * the cookies from handshake or routing breaks. (Confirmed against the deployed
 * reference: "All requests in a session must use the same axios instance to
 * preserve cookies for session affinity.")
 *
 * Flow (matches the captured CCUI trace):
 *   handshake → subscribe AGENT channel → connect(initial) → createSN(HTTP) →
 *   long-poll /sync/connect. When the consumer accepts, a `startSession` push
 *   arrives on the AGENT channel `/a/{brandId}/{base64}` carrying the short SN
 *   ticket `t`; we exchange it at /login/access_token for the OAuth-signed agent
 *   room URL and emit `canStartCall`.
 *
 * The ticket-room join/subscribe/heartbeat are best-effort (they 403 on this
 * account) — the accept is delivered on the agent channel regardless.
 */

interface CometDMessage {
  id?: string;
  channel: string;
  clientId?: string;
  successful?: boolean;
  subscription?: string;
  connectionType?: string;
  data?: unknown;
  advice?: Record<string, unknown>;
  ext?: Record<string, unknown>;
  error?: string;
  version?: string;
  minimumVersion?: string;
  supportedConnectionTypes?: string[];
}

export interface CobrowseStartParams {
  brandId: string;
  accessToken: string;
  agentId: string; // fully-qualified brandId.numeric
  agentName?: string;
  conversationId: string;
  consumerId: string;
  serviceId: string;
  skillId?: string;
  mode: string; // 'cobrowse' | 'voice-call' | 'video-call'
  region?: string;
  sharkSessionId?: string;
  sharkVisitorId?: string;
}

export type CobrowseEvent =
  | { type: 'connected' }
  | { type: 'handshake'; clientId: string }
  | { type: 'ticketCreated'; ticket: string; callUrl: string }
  | { type: 'consumerJoining'; senderId?: string | number }
  | { type: 'canStartCall'; ticket: string; signedUrl: string }
  | { type: 'error'; error: string }
  | { type: 'disconnected' }
  | { type: 'debug'; step: string; [k: string]: unknown };

export class CobrowseSession extends EventEmitter {
  clientId: string | null = null;
  /** createSN result (the serviceId echo). */
  ticket: string | null = null;
  messageId = 0;
  aborted = false;
  readonly cookies = new Map<string, string>();
  readonly key: string;

  /** Invite dialog info + accept flag, set by the route, for stop/cancel. */
  inviteDialogId: string | null = null;
  inviteMode: string | null = null;
  accepted = false;
  onStop: (() => Promise<void> | void) | null = null;
  /** The authenticated room URL (e.g. .../proxyless?...) once the consumer accepts.
   * Served to the browser via the server-side proxy (the browser has no LE session). */
  roomUrl: string | null = null;

  /** Buffer events so a late-attaching SSE listener doesn't miss early ones. */
  private readonly buffer: CobrowseEvent[] = [];

  constructor(private readonly p: CobrowseStartParams) {
    super();
    this.p.region ??= 'ause1';
    this.key = `${p.brandId}_${p.agentId.replace(/[.:]/g, '-')}_${p.conversationId}`;
  }

  emit(type: string, ...args: unknown[]): boolean {
    if (type === 'event' && args[0]) this.buffer.push(args[0] as CobrowseEvent);
    return super.emit(type, ...args);
  }

  replay(fn: (e: CobrowseEvent) => void): void {
    for (const e of this.buffer) fn(e);
  }

  private domain(): string {
    return `${this.p.brandId}.${this.p.region}.cobrowse.liveperson.net`;
  }
  /** Public accessors for the WS proxy (server-side upgrade handler). */
  cobrowseDomain(): string {
    return this.domain();
  }
  cookieHeaderPublic(): string {
    return this.cookieHeader();
  }
  private syncBase(): string {
    return `https://${this.domain()}/sync`;
  }
  private authExt(): Record<string, unknown> {
    return { 'com.liveperson.authz': { accessToken: this.p.accessToken, integration: 'le2' } };
  }
  private agentChannelId(): string {
    const numericId = this.numericAgentId();
    return Buffer.from(`${this.p.brandId}:${numericId}`).toString('base64').replace(/=+$/, '');
  }
  private numericAgentId(): string {
    return this.p.agentId.includes('.') ? this.p.agentId.split('.')[1] : this.p.agentId;
  }
  /** Display name shown in the cobrowse room. loginName is account-prefixed
   * (e.g. "31487986-brandt"); strip the "{accountId}-" so it reads as just the name. */
  private displayName(): string {
    const raw = (this.p.agentName ?? '').trim() || 'Agent'; // empty string → 'Agent'
    return raw.startsWith(`${this.p.brandId}-`) ? raw.slice(this.p.brandId.length + 1) : raw;
  }
  private nextId(): string {
    return String(++this.messageId);
  }
  private cookieHeader(): string {
    return Array.from(this.cookies.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
  }
  private parseCookies(headers: string[]): Array<[string, string]> {
    const out: Array<[string, string]> = [];
    for (const h of headers) {
      const first = h.trim().split(';')[0];
      const eq = first.indexOf('=');
      if (eq > 0) out.push([first.slice(0, eq).trim(), first.slice(eq + 1).trim()]);
    }
    return out;
  }

  /** Raw HTTP POST that captures Set-Cookie into the jar and sends it back. */
  private nodePost(
    url: string,
    body: string,
    contentType: string,
  ): Promise<{ status: number; body: string; setCookies: string[] }> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const buf = Buffer.from(body, 'utf8');
      const headers: Record<string, string | number> = {
        'Content-Type': contentType,
        'Content-Length': buf.length,
        Host: parsed.host,
        Origin: `https://${this.domain()}`,
        'X-Requested-With': 'XMLHttpRequest',
      };
      const cookie = this.cookieHeader();
      if (cookie) headers['Cookie'] = cookie;
      const mod = parsed.protocol === 'https:' ? https : http;
      const req = mod.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
          path: parsed.pathname + parsed.search,
          method: 'POST',
          headers,
        },
        (res) => {
          const raw = res.headers['set-cookie'] as string[] | string | undefined;
          const setCookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () =>
            resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), setCookies }),
          );
        },
      );
      req.on('error', reject);
      req.write(buf);
      req.end();
    });
  }

  /** CometD POST: JSON body, merges Set-Cookie into the sticky jar. */
  private async post(url: string, body: CometDMessage[]): Promise<CometDMessage[]> {
    const res = await this.nodePost(url, JSON.stringify(body), 'application/json;charset=UTF-8');
    for (const [k, v] of this.parseCookies(res.setCookies)) this.cookies.set(k, v);
    if (res.status < 200 || res.status >= 300) throw new Error(`CometD HTTP ${res.status} at ${url}`);
    return JSON.parse(res.body) as CometDMessage[];
  }

  // ── Flow ───────────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    try {
      await this.handshake();
      // The consumer's accept (`startSession`) push lands on the AGENT channel.
      await this.subscribeAgentChannel();
      await this.connectInitial();
      await this.createServiceNumber();
      this.emit('event', { type: 'ticketCreated', ticket: this.ticket!, callUrl: this.buildCallUrl(this.ticket!) } as CobrowseEvent);
      // Best-effort (often 403 on this account; accept arrives on the agent channel).
      await this.joinTicketRoom();
      await this.subscribeTicketChannels();
      await this.sendHeartbeat();
      this.emit('event', { type: 'connected' } as CobrowseEvent);
      void this.longPollLoop();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emit('event', { type: 'error', error: msg } as CobrowseEvent);
      this.aborted = true;
      throw err;
    }
  }

  stop(): void {
    this.aborted = true;
    void Promise.resolve(this.onStop?.()).catch((err) =>
      console.warn('[cobrowse] onStop failed:', err instanceof Error ? err.message : err),
    );
    this.emit('event', { type: 'disconnected' } as CobrowseEvent);
  }

  private async handshake(): Promise<void> {
    const res = await this.post(`${this.syncBase()}/handshake`, [
      {
        id: this.nextId(),
        version: '1.0',
        minimumVersion: '1.0',
        channel: '/meta/handshake',
        supportedConnectionTypes: ['long-polling'],
        advice: { timeout: 60_000, interval: 0 },
        ext: this.authExt(),
      },
    ]);
    const msg = res[0];
    if (!msg?.successful || !msg.clientId) throw new Error(`handshake failed: ${JSON.stringify(res)}`);
    this.clientId = msg.clientId;
    this.emit('event', { type: 'handshake', clientId: this.clientId } as CobrowseEvent);
  }

  private async subscribeAgentChannel(): Promise<void> {
    const subscription = `/a/${this.p.brandId}/${this.agentChannelId()}`;
    const res = await this.post(`${this.syncBase()}/`, [
      {
        id: this.nextId(),
        channel: '/meta/subscribe',
        subscription,
        clientId: this.clientId!,
        ext: this.authExt(),
      },
    ]);
    if (!res[0]?.successful) console.warn('[cobrowse] agent-channel subscribe failed:', JSON.stringify(res));
    else dbg('[cobrowse] subscribed agent channel:', subscription);
  }

  private async connectInitial(): Promise<void> {
    const res = await this.post(`${this.syncBase()}/connect`, [
      {
        id: this.nextId(),
        channel: '/meta/connect',
        connectionType: 'long-polling',
        advice: { timeout: 0 },
        clientId: this.clientId!,
        ext: this.authExt(),
      },
    ]);
    if (!res[0]?.successful) throw new Error(`initial connect failed: ${JSON.stringify(res)}`);
  }

  private async createServiceNumber(): Promise<void> {
    const url = `https://${this.domain()}/ajax?request.preventCache=${Date.now()}`;
    const form = new URLSearchParams();
    form.append('action', 'createSN');
    form.append('context', 'LIVEENGAGE');
    form.append('aA', this.displayName());
    form.append('aI', `${this.p.brandId}:${this.numericAgentId()}`);
    form.append('p', this.p.mode);
    form.append('vI', this.p.consumerId);
    form.append('aCI', this.clientId!);
    form.append('tI', this.p.brandId);
    form.append('conversationId', this.p.conversationId);
    if (this.p.sharkSessionId) form.append('sharkSessionId', this.p.sharkSessionId);
    if (this.p.sharkVisitorId) form.append('sharkVisitorId', this.p.sharkVisitorId);
    if (this.p.skillId) form.append('skillId', this.p.skillId);
    form.append('sI', this.p.serviceId);

    dbg('[cobrowse] createSN skillId=', this.p.skillId, 'mode=', this.p.mode, 'body:', form.toString());
    const res = await this.nodePost(url, form.toString(), 'application/x-www-form-urlencoded');
    for (const [k, v] of this.parseCookies(res.setCookies)) this.cookies.set(k, v);
    dbg('[cobrowse] createSN response:', res.status, res.body);
    this.emit('event', { type: 'debug', step: 'createSN', status: res.status, body: res.body.slice(0, 300) } as CobrowseEvent);
    if (res.status < 200 || res.status >= 300) throw new Error(`createSN HTTP ${res.status}: ${res.body}`);
    const data = JSON.parse(res.body) as Record<string, unknown>;
    if (!data.result) throw new Error(`createSN no result: ${JSON.stringify(data)}`);
    this.ticket = String(data.result);
  }

  /**
   * The "proxyless" room profile — a DIFFERENT vocabulary from the UMS invite mode:
   *   cobrowse   → p-view   (the captured value)
   *   video-call → p-video-call
   *   voice-call → p-voice-call
   * It's derived from the createSN mode (this.p.mode, hyphenated), NOT inviteMode
   * (which is UMS's VIDEO_CALL/VOICE_CALL — using that gives p-VIDEO_CALL and 401s).
   */
  private proxylessProfile(): string {
    if (this.p.mode === 'cobrowse') return 'p-view';
    return `p-${this.p.mode}`; // video-call → p-video-call, voice-call → p-voice-call
  }

  /** Plain (unsigned) call URL — only for the early ticketCreated event / fallback. */
  private buildCallUrl(ticket: string): string {
    const params = new URLSearchParams({
      ticket,
      profile: this.proxylessProfile(),
      username: this.displayName(),
      siteId: this.p.brandId,
      accdndomain: 'accdn.lpsnmedia.net',
    });
    if (this.p.skillId) params.append('skillId', this.p.skillId);
    return `https://${this.domain()}/call?${params.toString()}`;
  }

  /** The room path signed into the access_token request. All modes use the same
   * /proxyless app (the captured signedUrl exposed hasView/hasVideo/hasVoice flags
   * regardless of mode) — the MODE is carried by the `profile`, not the path:
   *   cobrowse → p-view, video-call → p-video-call, voice-call → p-voice-call. */
  private roomPath(ticket: string): string {
    const t = encodeURIComponent(ticket);
    // Two distinct rooms (confirmed by captures):
    //   cobrowse → /proxyless?profile=p-view   (synchronite screen-share)
    //   calls    → /call?profile=video-call|voice-call   (WebRTC call window)
    // username goes in the FORM field (not the path — adding it here makes the
    // access_token signing 400). LP appends it to the redirect from the form field.
    if (this.p.mode === 'cobrowse') {
      return `/proxyless?ticket=${t}&profile=${encodeURIComponent(this.proxylessProfile())}`;
    }
    // The /call room renders `config.skillId` from the URL's skillId param; an empty
    // value yields malformed JS (`skillId:\n}`) that aborts the room → "call ended".
    const skill = this.p.skillId ? `&skillId=${encodeURIComponent(this.p.skillId)}` : '';
    return `/call?ticket=${t}&profile=${encodeURIComponent(this.p.mode)}${skill}`;
  }

  /** Exchange the short SN ticket for the OAuth-signed agent room URL. */
  private async getSignedCallUrl(ticket: string): Promise<string> {
    const url = `https://${this.domain()}/login/access_token?request.preventCache=${Date.now()}`;
    const form = new URLSearchParams();
    form.append('access_token', this.p.accessToken);
    form.append('ticket', ticket);
    form.append('url', this.roomPath(ticket));
    form.append('username', this.displayName()); // LP appends this to the redirect
    form.append('integration', 'le2');
    dbg('[cobrowse] displayName:', JSON.stringify(this.displayName()), 'agentName:', JSON.stringify(this.p.agentName));
    dbg('[cobrowse] access_token url param:', this.roomPath(ticket));
    const res = await this.nodePost(url, form.toString(), 'application/x-www-form-urlencoded');
    dbg('[cobrowse] access_token status:', res.status, 'body:', res.body.slice(0, 300));
    if (res.status < 200 || res.status >= 300) throw new Error(`access_token HTTP ${res.status}: ${res.body}`);
    const data = JSON.parse(res.body) as { signedUrl?: string };
    if (!data.signedUrl) throw new Error(`no signedUrl in access_token response: ${res.body.slice(0, 200)}`);
    dbg('[cobrowse] signedUrl:', data.signedUrl);
    return data.signedUrl;
  }

  private canStartEmitted = false;
  private async emitCanStartCall(ticket: string): Promise<void> {
    // The accept can arrive twice (agent-channel push + long-poll, or a repeated
    // consumer startSession). Sign + emit once per session — re-signing the same
    // ticket mints a new session and can invalidate the first ("call has ended").
    if (this.canStartEmitted) return;
    this.canStartEmitted = true;

    let signedUrl: string;
    try {
      signedUrl = await this.getSignedCallUrl(ticket);
    } catch (err) {
      console.warn('[cobrowse] sign call URL failed, using plain URL:', err instanceof Error ? err.message : err);
      signedUrl = this.buildCallUrl(ticket);
    }
    // Authenticate our server jar through /oauth → /login/callback (sets the cobrowse
    // session cookie) and resolve the final /proxyless room URL. The browser can't
    // do this (no LE session), so we serve the room via the server proxy. The
    // `signedUrl` we emit is OUR proxy endpoint, not the raw cobrowse URL.
    try {
      this.roomUrl = await this.authenticateRoom(signedUrl);
      dbg('[cobrowse] room authenticated, url:', this.roomUrl);
    } catch (err) {
      console.warn('[cobrowse] authenticateRoom failed:', err instanceof Error ? err.message : err);
      this.roomUrl = signedUrl; // fall back to raw (popup may still work if LE-logged-in)
    }
    // The client opens the room over the HTTPS origin (synchronite forces https/wss
    // to the page origin; our HTTP dev port can't satisfy that). The proxy route
    // serves it there, same-origin, so the room's own secure requests work.
    const httpsOrigin = process.env.COBROWSE_HTTPS_ORIGIN ?? `https://localhost:${process.env.COBROWSE_HTTPS_PORT ?? 9443}`;
    this.emit('event', { type: 'canStartCall', ticket, signedUrl: `${httpsOrigin}/api/cobrowse/${this.key}/room` } as CobrowseEvent);
  }

  /** Raw GET that does NOT follow redirects; merges Set-Cookie into the jar. */
  private rawGet(url: string): Promise<{ status: number; location?: string; setCookie: string[]; body: Buffer; contentType?: string }> {
    const parsed = new URL(url);
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: parsed.hostname,
          path: parsed.pathname + parsed.search,
          method: 'GET',
          headers: {
            Cookie: this.cookieHeader(),
            Origin: `https://${this.domain()}`,
            'User-Agent': 'Mozilla/5.0',
            Accept: '*/*',
          },
        },
        (res) => {
          const raw = res.headers['set-cookie'];
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              location: res.headers.location,
              setCookie: Array.isArray(raw) ? raw : raw ? [raw] : [],
              body: Buffer.concat(chunks),
              contentType: res.headers['content-type'],
            }),
          );
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  /** Follow /oauth's redirect chain with our authenticated jar, capturing the
   * session cookie, and return the final absolute room URL. The room is /proxyless
   * for cobrowse or /call for video/voice — handle both (the `redirect` query on
   * /oauth & /successfullogin carries the real room path). */
  private async authenticateRoom(signedUrl: string): Promise<string> {
    const isRoomPath = (p: string) => p.includes('proxyless') || p.includes('/call');
    let url = signedUrl;
    let capturedRoom: string | null = null;
    for (let hop = 0; hop < 8; hop++) {
      const parsed = new URL(url);
      const res = await this.rawGet(url);
      for (const [k, v] of this.parseCookies(res.setCookie)) this.cookies.set(k, v);
      dbg(`[cobrowse] auth hop ${hop}: ${res.status} ${parsed.pathname} → ${res.location ?? '(end)'}`);
      // /oauth & /successfullogin carry the real room path in their `redirect` query.
      const redirectQ = parsed.searchParams.get('redirect');
      if (redirectQ && isRoomPath(redirectQ)) {
        capturedRoom = `https://${parsed.hostname}/${redirectQ.replace(/^\//, '')}`;
      }
      if (res.status >= 300 && res.status < 400 && res.location) {
        url = res.location.startsWith('http') ? res.location : `https://${parsed.hostname}${res.location.startsWith('/') ? '' : '/'}${res.location}`;
      } else {
        // Reached a 200. If this IS the room, use it; else the captured redirect.
        if (isRoomPath(parsed.pathname)) return url;
        if (capturedRoom) return capturedRoom;
        return url;
      }
    }
    return capturedRoom ?? url;
  }

  /** Proxy a single room request (any method/body, with our auth jar). Path is
   * relative to the cobrowse host (e.g. /proxyless?…, /sync/connect, /assets/…). */
  async proxyRoomRequest(
    pathAndQuery: string,
    opts: { method?: string; body?: Buffer; contentType?: string } = {},
  ): Promise<{ status: number; body: Buffer; contentType?: string; location?: string }> {
    const url = pathAndQuery.startsWith('http')
      ? pathAndQuery
      : `https://${this.domain()}${pathAndQuery.startsWith('/') ? '' : '/'}${pathAndQuery}`;
    const parsed = new URL(url);
    const method = opts.method ?? 'GET';
    const res = await new Promise<{ status: number; location?: string; setCookie: string[]; body: Buffer; contentType?: string }>(
      (resolve, reject) => {
        const headers: Record<string, string | number> = {
          Cookie: this.cookieHeader(),
          Origin: `https://${this.domain()}`,
          'User-Agent': 'Mozilla/5.0',
          Accept: '*/*',
          'X-Requested-With': 'XMLHttpRequest',
        };
        if (opts.body) {
          headers['Content-Type'] = opts.contentType ?? 'application/json;charset=UTF-8';
          headers['Content-Length'] = opts.body.length;
        }
        const req = https.request(
          { hostname: parsed.hostname, path: parsed.pathname + parsed.search, method, headers },
          (r) => {
            const raw = r.headers['set-cookie'];
            const chunks: Buffer[] = [];
            r.on('data', (c: Buffer) => chunks.push(c));
            r.on('end', () =>
              resolve({
                status: r.statusCode ?? 0,
                location: r.headers.location,
                setCookie: Array.isArray(raw) ? raw : raw ? [raw] : [],
                body: Buffer.concat(chunks),
                contentType: r.headers['content-type'],
              }),
            );
          },
        );
        req.on('error', reject);
        if (opts.body) req.write(opts.body);
        req.end();
      },
    );
    for (const [k, v] of this.parseCookies(res.setCookie)) this.cookies.set(k, v);
    return { status: res.status, body: res.body, contentType: res.contentType, location: res.location };
  }

  /** Join the ticket room as the agent (best-effort). */
  private async joinTicketRoom(): Promise<void> {
    const ticket = this.ticket!;
    const numeric = this.numericAgentId();
    try {
      const res = await this.post(`${this.syncBase()}/`, [
        {
          id: this.nextId(),
          channel: '/service/ticket',
          data: {
            action: 'join',
            tenant: this.p.brandId,
            senderId: Number.parseInt(numeric, 10) || numeric,
            ticket,
            isAgent: true,
            url: this.buildCallUrl(ticket),
          },
          clientId: this.clientId!,
          ext: this.authExt(),
        },
      ]);
      if (!res[0]?.successful) console.warn('[cobrowse] joinTicketRoom not successful:', JSON.stringify(res));
    } catch (err) {
      console.warn('[cobrowse] joinTicketRoom error:', err instanceof Error ? err.message : err);
    }
  }

  private async subscribeTicketChannels(): Promise<void> {
    const ticket = this.ticket!;
    for (const subscription of [`/t/sn/${this.p.brandId}/${ticket}`, `/pl/${this.p.brandId}/${ticket}`]) {
      try {
        const res = await this.post(`${this.syncBase()}/`, [
          { id: this.nextId(), channel: '/meta/subscribe', subscription, clientId: this.clientId!, ext: this.authExt() },
        ]);
        if (!res[0]?.successful) console.warn('[cobrowse] subscribe failed:', subscription, JSON.stringify(res));
      } catch (err) {
        console.warn('[cobrowse] subscribe error:', subscription, err instanceof Error ? err.message : err);
      }
    }
  }

  private async sendHeartbeat(): Promise<void> {
    const ticket = this.ticket!;
    const senderId = Number.parseInt(this.numericAgentId(), 10) || 0;
    try {
      await this.post(`${this.syncBase()}/`, [
        {
          id: this.nextId(),
          channel: `/pl/${this.p.brandId}/${ticket}`,
          data: { type: 'heartbeat', senderId, msg: { userId: senderId } },
          clientId: this.clientId!,
          ext: this.authExt(),
        },
      ]);
    } catch (err) {
      console.warn('[cobrowse] heartbeat failed:', err instanceof Error ? err.message : err);
    }
  }

  /** Long-poll /sync/connect to receive pushes (the accept lands here). */
  private async longPollLoop(): Promise<void> {
    const url = `${this.syncBase()}/connect`;
    while (!this.aborted) {
      try {
        const res = await this.post(url, [
          {
            id: this.nextId(),
            channel: '/meta/connect',
            connectionType: 'long-polling',
            clientId: this.clientId!,
            ext: this.authExt(),
          },
        ]);
        for (const msg of res) {
          if (!msg.channel || msg.channel.startsWith('/meta/')) continue;
          const d = msg.data as Record<string, unknown> | undefined;
          if (!d) continue;
          dbg('[cobrowse] push', msg.channel, JSON.stringify(d).slice(0, 300));
          this.emit('event', { type: 'debug', step: 'push', channel: msg.channel, data: d } as CobrowseEvent);
          // IMPORTANT: the event discriminator is `action` (e.g. "startSession").
          // `type` here is the cobrowse MODE ("cobrowse"/"view"), NOT the event type —
          // so we must read `action` first.
          const action = (d.action ?? d.type) as string | undefined;
          if (action === 'startSession' || action === 'canStartCall') {
            const ticket = (d.t ?? d.ticket) as string | undefined;
            if (ticket) {
              await this.emitCanStartCall(ticket);
              // keep polling — agent may invite again on the same session
            }
          } else if (action === 'consumerJoining') {
            this.emit('event', { type: 'consumerJoining', senderId: d.senderId as string | number } as CobrowseEvent);
          }
        }
        if (!this.aborted) await new Promise((r) => setTimeout(r, 300));
      } catch (err) {
        if (this.aborted) break;
        this.emit('event', { type: 'error', error: err instanceof Error ? err.message : String(err) } as CobrowseEvent);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
}

const active = new Map<string, CobrowseSession>();
export function putCobrowse(s: CobrowseSession): void {
  active.set(s.key, s);
}
export function getCobrowse(key: string): CobrowseSession | undefined {
  return active.get(key);
}
export function dropCobrowse(key: string): void {
  active.get(key)?.stop();
  active.delete(key);
}
