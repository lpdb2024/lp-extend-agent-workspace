import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import lpm from 'lp-messaging-sdk';
import type { Connection, Conversation, Message } from 'lp-messaging-sdk';
import type { AgentIdentity } from './lp-auth.js';
import { StaticTokenMaintainer } from './token-maintainer.js';
import { loadSkills } from './skills.js';
import { fetchAccountLanguage } from './properties.js';
import { dbg } from './debug.js';

// lp-messaging-sdk is CommonJS; under ESM only the default export is reliable,
// so destructure the named members from it at runtime.
const { createConnection, UserType, AgentState, ParticipantRole } = lpm;

/** How the agent authenticated to LP. Both carry the resolved AgentIdentity so we
 * can scope the subscription to this agent up front. */
export type AgentAuth =
  | { kind: 'password'; username: string; password: string; identity: AgentIdentity }
  | { kind: 'sso'; identity: AgentIdentity };

/** Show conversations updated within this window (90 days). */
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Resolve a participant's id robustly. Depending on UMS API version the SDK
 * populates `id`, `userId`, or `agentId` (consumer participant details arrive as
 * `{id, role, state}`, agents as `accountId.shortId`). Try them in order.
 */
function participantId(p: { id?: unknown; userId?: unknown; agentId?: unknown } | null | undefined): string | null {
  if (!p) return null;
  const v = p.id ?? p.userId ?? p.agentId;
  return v != null ? String(v) : null;
}

const APP_ID = 'com.extend.agent-chat-widget-poc';

/** A lightweight view of a message for the client. */
export interface ClientMessage {
  conversationId: string;
  sequence: number;
  time: number;
  body: string;
  contentType: string;
  role: string; // CONSUMER / ASSIGNED_AGENT / ...
  isFromConsumer: boolean;
  metadata: unknown[] | null;
  /** Special CONTROLLER message kinds, derived from metadata[].type.
   * 'summary'  → automated conversation summary (render as a card)
   * 'auto'     → system/auto message (render as centered text, no bubble)
   * undefined  → ordinary chat message */
  kind?: 'summary' | 'auto';
  /** Message audience — 'ALL' (visible to the consumer) or 'AGENTS_AND_MANAGERS'
   * (a private/internal message the consumer never sees). Defaults to 'ALL'. */
  audience?: 'ALL' | 'AGENTS_AND_MANAGERS';
  /** Hosted-file fields (present when the message is a shared file). */
  file?: {
    fileType: string | null; // e.g. PNG, JPG, PDF
    caption: string | null;
    relativePath: string | null; // for on-demand download
    /** base64 thumbnail (images only) — data is the raw base64, no data: prefix. */
    preview: string | null;
  };
  /** Secure-form invitation/submission (contentType forms/secure-*). */
  secureForm?: {
    kind: 'invitation' | 'submission';
    formId: string | null;
    title: string | null;
    invitationId: string | null;
    submissionId: string | null; // present on submissions
  };
}

/** Conversation status derived for the list UI. */
export type ConvStatus = 'queued' | 'active' | 'idle' | 'urgent' | 'overdue';

/** An enriched view of a conversation for the agent list. */
export interface ClientConversation {
  conversationId: string;
  dialogId: string | null;
  consumerId: string | null;
  consumerName: string;
  assignedAgentId: string | null;
  skillId: string | null;
  skillName: string | null;
  status: ConvStatus;
  /** Effective TTR deadline (ms epoch) and seconds remaining (negative = overdue). */
  ttrDeadline: number | null;
  ttrSecondsLeft: number | null;
  ttrType: string | null;
  startTime: number | null;
  updateTime: number | null;
  lastMessage: string | null;
  lastMessageFromConsumer: boolean;
  unread: number;
  /** Channel/source from MI API, e.g. 'FACEBOOK', 'WEB', 'SHARK'. null until MI is fetched. */
  channel: string | null;
}

/**
 * One agent session = one brand-side SDK connection + its conversation cache +
 * an event bus the SSE routes subscribe to. Held in memory (POC-grade).
 */
export class AgentSession extends EventEmitter {
  readonly id = randomUUID();
  readonly connection: Connection;
  readonly accountId: string;
  readonly loginName: string;
  readonly displayName: string;
  readonly email: string | undefined;
  readonly imageUrl: string | undefined;
  readonly agentId: string;
  private skillsById = new Map<string, string>();
  /** MI-resolved consumer name per conversationId (overrides SDK 'Visitor'). */
  readonly consumerNameCache = new Map<string, string>();
  /** MI-resolved channel/source per conversationId (e.g. 'FACEBOOK', 'WEB'). */
  readonly channelCache = new Map<string, string>();
  private readonly wired = new Set<string>();
  /** Conversations we've already seen assigned to THIS agent — used to fire an
   * `assigned` event only on the transition (queue/other-agent → me). */
  private readonly assignedToMe = new Set<string>();
  /** True until the first conversation batch is processed, so initial rows don't
   * each pop a "new conversation" toast on login. */
  private hydrating = true;
  connected = false;
  lastError: string | null = null;
  agentState: string = 'ONLINE';
  readonly skillIds: number[];
  readonly agentGroupId: number | undefined;
  readonly agentGroupName: string | undefined;
  readonly bearer: string;
  accountLang: string = 'en-US';

  constructor(accountId: string, auth: AgentAuth, loginName: string) {
    super();
    this.accountId = accountId;
    this.loginName = loginName;
    this.displayName = auth.identity.displayName ?? loginName;
    this.email = auth.identity.email;
    this.imageUrl = auth.identity.imageUrl;
    this.bearer = auth.identity.bearer;
    this.agentId = auth.identity.agentId;
    this.skillIds = auth.identity.skillIds ?? [];
    this.agentGroupId = auth.identity.agentGroupId;
    this.agentGroupName = auth.identity.agentGroupName;

    // Scope the default subscription to THIS agent's OPEN conversations in the
    // last 90 days — not the account-wide default. UMS returns only conversations
    // where this agent is a participant, so we never join/hijack others.
    const defaultSubscriptionQuery = {
      agentId: this.agentId,
      stage: ['OPEN'],
      lastUpdateAfter: Date.now() - NINETY_DAYS_MS,
    };

    if (auth.kind === 'password') {
      this.connection = createConnection({
        appId: APP_ID,
        accountId,
        userType: UserType.BRAND,
        authData: { username: auth.username, password: auth.password },
        defaultSubscriptionQuery,
        getAllMessages: true,
      });
    } else {
      this.connection = createConnection({
        appId: APP_ID,
        accountId,
        userType: UserType.BRAND,
        tokenMaintainer: new StaticTokenMaintainer(auth.identity),
        defaultSubscriptionQuery,
        getAllMessages: true,
      });
    }
    this.wire();
  }

  private wire(): void {
    const c = this.connection;

    // SDK emits 'connect' (not 'connected') once the UMS websocket is up,
    // 'disconnect'/'close' when it drops, 'error'/'failed-to-connect' on failure.
    c.on('connect', () => {
      this.connected = true;
      this.emit('status', { connected: true });
    });
    c.on('reconnect', () => {
      this.connected = true;
      this.emit('status', { connected: true });
    });
    c.on('disconnect', () => {
      this.connected = false;
      this.emit('status', { connected: false });
    });
    c.on('close', () => {
      this.connected = false;
      this.emit('status', { connected: false });
    });
    c.on('error', (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastError = msg;
      // The SDK routes non-fatal queryMessages failures (e.g. "no conversation to
      // send for MCCA" on idle/older dialogs) through the connection error event.
      // These are expected for history-loaded conversations and are handled by the
      // raw-notification fallbacks + getMessages() cache, so don't toast or log them
      // at warn level (they're noisy). Visible only under COBROWSE_DEBUG.
      if (/queryMessages|MCCA/i.test(msg)) {
        dbg('[lp] suppressed non-fatal error:', msg);
        return;
      }
      this.emit('error', msg);
    });

    // Conversations matching our scoped subscription (this agent, OPEN, 90 days).
    c.on('conversation', (conv: Conversation) => {
      dbg(`[conversation] sdk event conv=${conv.conversationId} stage=${conv.stage} assigned=${participantId(conv.assignedAgent)}`);
      this.onConversation(conv);
    });

    // Raw notification fallback for BOTH live content events and conversation changes —
    // the SDK silently drops some live events ("no conversation to send for MCCA") when a
    // conversation is loaded from history rather than actively subscribed.
    c.on('notification', (n: unknown) => {
      const note = n as { type?: string; body?: Record<string, unknown> } | undefined;
      if (!note?.body) return;
      if (note.type === '.ams.ms.OnlineEventDistribution') this.handleOnlineEvent(note.body);
      else if (note.type?.endsWith('ExConversationChangeNotification')) this.handleConversationChange(note.body);
    });

    // New messages bubble to connection level as `conversation:message` (see
    // dialog.emit -> conversation._emitUp). Because this connection-level listener
    // exists, the SDK does NOT also fire the per-conversation 'message' event — so
    // this is the single source of truth for live messages.
    // Payload is { conversation, message } (message is also passed as an extra arg).
    c.on('conversation:message', (...emitted: unknown[]) => {
      const p = emitted[0] as { conversation?: Conversation; message?: Message } | undefined;
      const conv = p?.conversation;
      const msg = (p?.message ?? emitted[1]) as Message | undefined;
      if (conv && msg) {
        dbg(`[conv:message] seq=${msg.sequence} ct=${msg.contentType} from=${msg.participant?.role}`);
        this.emitMessage(conv, msg);
        // Bump the list row (last message / status / assignment) too.
        this.refreshConversation(conv);
      }
    });
  }

  /** Is this conversation currently assigned to the logged-in agent? */
  private isAssignedToMe(conv: Conversation): boolean {
    const id = participantId(conv.assignedAgent);
    if (!id) return false;
    const short = this.agentId.split('.')[1] ?? this.agentId;
    return id === this.agentId || id === short || id === `${this.accountId}.${short}`;
  }

  private onConversation(conv: Conversation): void {
    try {
      // Observe only — DO NOT join. The subscription is already scoped to this
      // agent's conversations, so we render them read-through without reassigning.
      if (!this.wired.has(conv.conversationId)) {
        this.wired.add(conv.conversationId);
        // Re-emit an updated row on ANY conversation change so the list stays live:
        // skill/TTR/assignment changes, state, close, and the catch-all `notification`
        // (every UMS event for this conversation — message accepts, agent joins, etc.).
        const reemit = () => this.refreshConversation(conv);
        for (const ev of [
          'skill-change',
          'ttr-change',
          'manual-ettr-change',
          'group-change',
          'dialog',
          'notification',
          'close',
        ]) {
          conv.on(ev, reemit);
        }
      }
      this.refreshConversation(conv);
    } catch (err) {
      this.emit('error', err instanceof Error ? err.message : String(err));
    }
  }

  /** Emit an updated list row, and fire `assigned` when a conversation transitions
   * to being assigned to THIS agent (so the client can notify). */
  private refreshConversation(conv: Conversation): void {
    const view = this.viewConversation(conv);
    this.emit('conversation', view);

    const mine = this.isAssignedToMe(conv);
    const had = this.assignedToMe.has(conv.conversationId);
    if (mine && !had) {
      this.assignedToMe.add(conv.conversationId);
      // Don't toast the initial batch on login — only genuine new assignments.
      if (!this.hydrating) this.emit('assigned', view);
    } else if (!mine && had) {
      this.assignedToMe.delete(conv.conversationId);
    }
  }

  /** Track (conversationId, sequence) we've already emitted so the SDK path and the
   * raw OnlineEventDistribution path don't double-emit the same message. */
  private readonly emittedSeq = new Set<string>();
  private markEmitted(conversationId: string, sequence: number): boolean {
    const key = `${conversationId}:${sequence}`;
    if (this.emittedSeq.has(key)) return false;
    this.emittedSeq.add(key);
    if (this.emittedSeq.size > 5000) {
      // Bound the set — drop the oldest ~1000 (insertion order).
      for (const k of [...this.emittedSeq].slice(0, 1000)) this.emittedSeq.delete(k);
    }
    return true;
  }

  private emitMessage(conv: Conversation, msg: Message): void {
    if (!this.markEmitted(conv.conversationId, msg.sequence)) return;
    this.emit('message', this.viewMessage(conv, msg));
  }

  /**
   * Build + emit a ClientMessage straight from a raw `.ams.ms.OnlineEventDistribution`
   * notification body (the live ContentEvent wire shape). Used as a fallback when the
   * SDK fails to route the event to a dialog. Mirrors viewMessage's content-type logic.
   */
  private handleOnlineEvent(body: Record<string, unknown>): void {
    const event = body.event as { type?: string; contentType?: string; message?: unknown } | undefined;
    if (!event || event.type !== 'ContentEvent') return; // only chat/content events
    const conversationId = String(body.conversationId ?? '');
    const sequence = typeof body.sequence === 'number' ? body.sequence : -1;
    if (!conversationId || sequence < 0) return;
    if (!this.markEmitted(conversationId, sequence)) return; // already emitted via SDK path

    const role = ((body.originatorMetadata as { role?: string } | undefined)?.role) ?? 'UNKNOWN';
    const ct = event.contentType ?? 'text/plain';
    const rawMsg = event.message;
    const bodyText = typeof rawMsg === 'string' ? rawMsg : rawMsg == null ? '' : JSON.stringify(rawMsg);

    // Secure-form invitation/submission carry a structured message payload.
    let secureForm: ClientMessage['secureForm'];
    if (ct === 'forms/secure-invitation' || ct === 'forms/secure-submission') {
      const m = (typeof rawMsg === 'object' && rawMsg ? rawMsg : {}) as Record<string, unknown>;
      secureForm = {
        kind: ct === 'forms/secure-invitation' ? 'invitation' : 'submission',
        formId: m.formId != null ? String(m.formId) : null,
        title: typeof m.title === 'string' ? m.title : null,
        invitationId: typeof m.invitationId === 'string' ? m.invitationId : null,
        submissionId: typeof m.submissionId === 'string' ? m.submissionId : null,
      };
    }

    // Hosted-file message: the live ContentEvent body is the hosted-file payload
    // (object or JSON string with relativePath/fileType/caption/preview). Parse it so
    // the UI renders an image/file instead of dumping raw JSON. (Same shape the
    // history path parses in viewMessage — but live events come through here.)
    let file: ClientMessage['file'];
    if (!secureForm) {
      let hf: Record<string, unknown> | null = null;
      if (typeof rawMsg === 'object' && rawMsg) hf = rawMsg as Record<string, unknown>;
      else if (typeof bodyText === 'string' && bodyText.startsWith('{') && bodyText.includes('relativePath')) {
        try {
          hf = JSON.parse(bodyText) as Record<string, unknown>;
        } catch {
          /* not a hosted-file payload */
        }
      }
      if (hf && (hf.relativePath != null || hf.fileType != null)) {
        file = {
          fileType: typeof hf.fileType === 'string' ? hf.fileType : null,
          caption: typeof hf.caption === 'string' ? hf.caption : null,
          relativePath: typeof hf.relativePath === 'string' ? hf.relativePath : null,
          preview: typeof hf.preview === 'string' ? hf.preview : null,
        };
      }
    }

    // Private (agents-only) messages carry messageAudience on the notification body.
    const audRaw = (body.messageAudience ?? (event as { audience?: string }).audience) as
      | string
      | undefined;
    const audience = audRaw === 'AGENTS_AND_MANAGERS' ? 'AGENTS_AND_MANAGERS' : undefined;

    const view: ClientMessage = {
      conversationId,
      sequence,
      time: typeof body.serverTimestamp === 'number' ? body.serverTimestamp : Date.now(),
      body: file ? file.caption ?? '' : secureForm ? secureForm.title ?? '' : bodyText,
      contentType: ct,
      role,
      isFromConsumer: role === ParticipantRole.CONSUMER,
      metadata: (body.metadata as unknown[]) ?? null,
      ...(audience ? { audience } : {}),
      ...(file ? { file } : {}),
      ...(secureForm ? { secureForm } : {}),
    };
    dbg(`[online-event] seq=${sequence} ct=${ct} from=${role} aud=${audRaw ?? '-'} file=${!!file}`);
    this.emit('message', view);
  }

  /**
   * Raw `ExConversationChangeNotification` fallback. If the SDK already tracks the
   * conversation, re-emit through the full viewConversation path. Otherwise build a
   * ClientConversation straight from the raw `conversationDetails` so new/queued
   * conversations the SDK didn't surface still appear in the list.
   */
  private handleConversationChange(body: Record<string, unknown>): void {
    const changes = (body.changes as Array<{ result?: Record<string, unknown> }> | undefined) ?? [];
    for (const ch of changes) {
      const result = ch.result;
      const details = result?.conversationDetails as Record<string, unknown> | undefined;
      const convId = (result?.convId ?? details?.convId) as string | undefined;
      if (!convId || !details) continue;

      // Prefer the SDK's richer view if it knows this conversation.
      const known = this.connection.getConversationById(convId);
      if (known) {
        this.onConversation(known);
        continue;
      }

      const view = this.rawConversationView(convId, details, result);
      dbg(`[conv-change] raw conv=${convId} status=${view.status} (SDK didn't have it)`);
      this.emit('conversation', view);

      const mine = view.assignedAgentId != null && this.isAgentId(view.assignedAgentId);
      if (mine && !this.assignedToMe.has(convId)) {
        this.assignedToMe.add(convId);
        if (!this.hydrating) this.emit('assigned', view);
      }
    }
  }

  /** Does this id refer to the logged-in agent (any of its forms)? */
  private isAgentId(id: string): boolean {
    const short = this.agentId.split('.')[1] ?? this.agentId;
    return id === this.agentId || id === short || id === `${this.accountId}.${short}`;
  }

  /** Build a ClientConversation from a raw ExConversationChangeNotification result. */
  private rawConversationView(
    convId: string,
    details: Record<string, unknown>,
    result: Record<string, unknown> | undefined,
  ): ClientConversation {
    const participants = (details.participants as Record<string, string[]> | undefined) ?? {};
    const assignedAgentId = participants.ASSIGNED_AGENT?.[0] ?? null;
    const consumerId = participants.CONSUMER?.[0] ?? null;
    const skillId = details.skillId != null ? String(details.skillId) : null;
    const ttr = details.ttr as { ttrType?: string } | undefined;
    const effectiveTtr = result?.effectiveTTR;
    const ttrDeadline = typeof effectiveTtr === 'number' && effectiveTtr > 0 ? effectiveTtr : null;
    const ttrSecondsLeft = ttrDeadline != null ? Math.round((ttrDeadline - Date.now()) / 1000) : null;

    const lce = result?.lastContentEventNotification as
      | { event?: { message?: unknown; contentType?: string }; originatorMetadata?: { role?: string } }
      | undefined;
    const lastMsgRaw = lce?.event?.message;
    const lastMessage = typeof lastMsgRaw === 'string' ? lastMsgRaw : lastMsgRaw != null ? JSON.stringify(lastMsgRaw) : null;
    const lastFromConsumer = lce?.originatorMetadata?.role === 'CONSUMER';

    // Status: no assigned agent → queued; else needs-reply heuristic from unread.
    const unreadMap = (details.numberOfunreadMessages as Record<string, number> | undefined) ?? {};
    const short = this.agentId.split('.')[1] ?? this.agentId;
    const unread = unreadMap[this.agentId] ?? unreadMap[`${this.accountId}.${short}`] ?? unreadMap[short] ?? 0;
    let status: ConvStatus;
    if (!assignedAgentId) status = 'queued';
    else if (unread > 0 || lastFromConsumer) {
      if (ttrSecondsLeft != null && ttrSecondsLeft < 0) status = 'overdue';
      else if (ttr?.ttrType === 'URGENT' || ttr?.ttrType === 'PRIORITIZED') status = 'urgent';
      else if (ttrSecondsLeft != null && ttrSecondsLeft <= 30) status = 'urgent';
      else status = 'active';
    } else status = 'idle';

    return {
      conversationId: convId,
      dialogId: convId,
      consumerId,
      consumerName: 'Visitor',
      assignedAgentId,
      skillId,
      skillName: skillId != null ? this.skillsById.get(skillId) ?? null : null,
      channel: this.channelCache.get(convId) ?? null,
      status,
      ttrDeadline,
      ttrSecondsLeft,
      ttrType: ttr?.ttrType ?? null,
      startTime: typeof details.startTs === 'number' ? details.startTs : null,
      updateTime: typeof details.metaDataLastUpdateTs === 'number' ? details.metaDataLastUpdateTs : Date.now(),
      lastMessage,
      lastMessageFromConsumer: lastFromConsumer,
      unread,
    };
  }

  private viewMessage(conv: Conversation, msg: Message): ClientMessage {
    const role = (msg.participant?.role as string) ?? 'UNKNOWN';
    // Hosted-file (DownloadableMessage): body is null; the file lives on
    // relativePath/fileType/caption/preview. Surface those so the UI can render
    // a thumbnail (images) or a file chip (PDFs) instead of "null".
    const dl = msg as Message & {
      isDownloadable?: boolean;
      relativePath?: string;
      fileType?: string;
      caption?: string;
      preview?: string | null;
    };
    let file = dl.isDownloadable
      ? {
          fileType: dl.fileType ?? null,
          caption: dl.caption ?? null,
          relativePath: dl.relativePath ?? null,
          preview: dl.preview ?? null,
        }
      : undefined;
    const rawBody = typeof msg.body === 'string' ? msg.body : msg.body == null ? '' : JSON.stringify(msg.body);

    // Some file messages (notably via the raw-notification fallback) arrive without
    // `isDownloadable` — the hosted-file payload is the body itself, an object or a
    // JSON string carrying relativePath/fileType/caption/preview. Parse it so the UI
    // renders an image/file instead of dumping raw JSON.
    if (!file) {
      let hf: Record<string, unknown> | null = null;
      if (typeof msg.body === 'object' && msg.body) hf = msg.body as Record<string, unknown>;
      else if (typeof rawBody === 'string' && rawBody.startsWith('{') && rawBody.includes('relativePath')) {
        try {
          hf = JSON.parse(rawBody) as Record<string, unknown>;
        } catch {
          /* not a hosted-file payload */
        }
      }
      if (hf && (hf.relativePath != null || hf.fileType != null)) {
        file = {
          fileType: typeof hf.fileType === 'string' ? hf.fileType : null,
          caption: typeof hf.caption === 'string' ? hf.caption : null,
          relativePath: typeof hf.relativePath === 'string' ? hf.relativePath : null,
          preview: typeof hf.preview === 'string' ? hf.preview : null,
        };
      }
    }

    // CONTROLLER messages carry a type in metadata: ConversationSummary (render as a
    // summary card) or AutoMessage (centered system text, no bubble).
    const meta = (msg.metadata as Array<{ type?: string }> | null) ?? [];
    const hasMeta = (t: string) => meta.some((m) => m?.type === t);
    let kind: ClientMessage['kind'];
    if (hasMeta('ConversationSummary')) kind = 'summary';
    else if (hasMeta('AutoMessage')) kind = 'auto';

    // Secure-form invitation/submission: ContentEvent with contentType forms/secure-*.
    // The message body is the structured payload (object, or JSON string), not text.
    const ct = msg.contentType ?? '';
    let secureForm: ClientMessage['secureForm'];
    if (ct === 'forms/secure-invitation' || ct === 'forms/secure-submission') {
      let m: Record<string, unknown> = {};
      if (typeof msg.body === 'object' && msg.body) m = msg.body as Record<string, unknown>;
      else if (typeof msg.body === 'string') {
        try {
          m = JSON.parse(msg.body) as Record<string, unknown>;
        } catch {
          /* leave empty */
        }
      }
      secureForm = {
        kind: ct === 'forms/secure-invitation' ? 'invitation' : 'submission',
        formId: m.formId != null ? String(m.formId) : null,
        title: typeof m.title === 'string' ? m.title : null,
        invitationId: typeof m.invitationId === 'string' ? m.invitationId : null,
        submissionId: typeof m.submissionId === 'string' ? m.submissionId : null,
      };
    }

    // Audience: AGENTS_AND_MANAGERS = private (consumer never sees it). The SDK may
    // expose it as `messageAudience` or `audience` depending on UMS version.
    const audRaw =
      (msg as Message & { messageAudience?: string; audience?: string }).messageAudience ??
      (msg as Message & { messageAudience?: string; audience?: string }).audience;
    const audience = audRaw === 'AGENTS_AND_MANAGERS' ? 'AGENTS_AND_MANAGERS' : undefined;

    return {
      conversationId: conv.conversationId,
      sequence: msg.sequence,
      time: msg.time,
      // For file messages, prefer the caption as the display text (often empty).
      body: file ? file.caption ?? '' : secureForm ? secureForm.title ?? '' : rawBody,
      contentType: msg.contentType,
      role,
      isFromConsumer: role === ParticipantRole.CONSUMER,
      metadata: msg.metadata,
      ...(kind ? { kind } : {}),
      ...(audience ? { audience } : {}),
      ...(file ? { file } : {}),
      ...(secureForm ? { secureForm } : {}),
    };
  }

  private viewConversation(conv: Conversation): ClientConversation {
    const consumer = conv.consumer;
    const assigned = conv.assignedAgent;
    const skillId = conv.skill?.skillId ?? null;
    const ttrDeadline = typeof conv.ttrEffective === 'number' && conv.ttrEffective > 0 ? conv.ttrEffective : null;
    const ttrSecondsLeft = ttrDeadline != null ? Math.round((ttrDeadline - Date.now()) / 1000) : null;

    // The ACTUAL last message on the MAIN dialog (any sender) — not just the last
    // consumer one. Drives both the preview text and the active/idle status.
    const main = conv.getDialog('MAIN') as { messages?: Message[] } | null;
    const msgs = (main?.messages as Message[] | undefined) ?? [];
    const last = msgs.length ? [...msgs].sort((a, b) => a.sequence - b.sequence).at(-1) : undefined;
    const lastDl = last as (Message & { isDownloadable?: boolean; fileType?: string; caption?: string }) | undefined;
    const lastMessage = !last
      ? null
      : lastDl?.isDownloadable
        ? lastDl.caption || `[${(lastDl.fileType ?? 'file').toUpperCase()} file]`
        : typeof last.body === 'string'
          ? last.body
          : '';
    const lastFromConsumer = last?.participant?.role === ParticipantRole.CONSUMER;

    // Agent's unread count (CCUI's core "needs a reply" signal).
    const unread = this.agentUnread(conv);

    const convId = conv.conversationId;
    return {
      conversationId: convId,
      dialogId: conv.openDialog?.dialogId ?? null,
      consumerId: participantId(consumer),
      consumerName: this.consumerNameCache.get(convId) ?? this.resolveConsumerName(conv),
      assignedAgentId: participantId(assigned),
      skillId,
      skillName: skillId != null ? this.skillsById.get(String(skillId)) ?? null : null,
      status: this.deriveStatus(conv, ttrSecondsLeft, unread, lastFromConsumer, participantId(assigned)),
      ttrDeadline,
      ttrSecondsLeft,
      ttrType: conv.ttrType ?? null,
      startTime: typeof conv.startTime === 'number' ? conv.startTime : null,
      updateTime: typeof conv.updateTime === 'number' ? conv.updateTime : null,
      lastMessage,
      lastMessageFromConsumer: lastFromConsumer,
      unread,
      channel: this.channelCache.get(convId) ?? null,
    };
  }

  /** How many messages the logged-in agent hasn't read on this conversation. */
  private agentUnread(conv: Conversation): number {
    const map = conv.numberOfunreadMessages;
    if (!map) return 0;
    const short = this.agentId.split('.')[1] ?? this.agentId;
    // Keyed by fully-qualified or short agent id depending on UMS version.
    return map[this.agentId] ?? map[`${this.accountId}.${short}`] ?? map[short] ?? 0;
  }

  /** Consumer display name from conversation context, else "Visitor" (CCUI behaviour). */
  private resolveConsumerName(conv: Conversation): string {
    const ctx = conv.context as Record<string, unknown> | null;
    const claims = (ctx?.authenticatedData as Record<string, unknown> | undefined)?.lp_sdes as
      | Array<Record<string, unknown>>
      | undefined;
    if (claims) {
      for (const sde of claims) {
        const personal = sde.personal as Record<string, unknown> | undefined;
        if (personal?.firstname || personal?.lastname) {
          return [personal.firstname, personal.lastname].filter(Boolean).join(' ').trim();
        }
      }
    }
    return 'Visitor';
  }

  /**
   * Derive the CCUI-style list status. The agent "needs to respond" when there are
   * unread consumer messages (or the last message is the consumer's). Combined with
   * the effective-TTR deadline this gives the buckets CCUI sorts by:
   *  - queued  : no agent assigned yet — sitting in the skill queue
   *  - overdue : needs a reply AND past the TTR deadline (past SLA)
   *  - urgent  : needs a reply AND deadline is close (or TTR type URGENT/PRIORITIZED)
   *  - active  : needs a reply, deadline still comfortable
   *  - idle    : agent is caught up — waiting on the consumer
   */
  private deriveStatus(
    conv: Conversation,
    secondsLeft: number | null,
    unread: number,
    lastFromConsumer: boolean,
    assignedAgentId: string | null,
  ): ConvStatus {
    // Unassigned conversations are still in the skill queue (CCUI orange "persons").
    if (!assignedAgentId) return 'queued';

    const needsReply = unread > 0 || lastFromConsumer;
    if (!needsReply) return 'idle';

    if (secondsLeft != null && secondsLeft < 0) return 'overdue';
    if (conv.ttrType === 'URGENT' || conv.ttrType === 'PRIORITIZED') return 'urgent';
    if (secondsLeft != null && secondsLeft <= 30) return 'urgent';
    return 'active';
  }

  getConversation(conversationId: string): Conversation {
    const conv = this.connection.getConversationById(conversationId);
    if (!conv) throw new Error(`Conversation not found: ${conversationId}`);
    return conv;
  }

  /**
   * The MAIN messaging dialog. Always use this for send/upload/history — NOT
   * conv.openDialog, which becomes the COBROWSE dialog after a call invite and
   * would silently misroute messages to a non-messaging dialog.
   */
  private mainDialog(conv: Conversation): {
    dialogId: string;
    state?: string;
    messages?: Message[];
    sendMessage(text: string, metadata?: unknown, quickReplies?: unknown): Promise<{ sequence: number }>;
    uploadFile(buffer: Buffer | ArrayBuffer, caption?: string): Promise<unknown>;
    queryMessages(query?: Record<string, unknown>): Promise<unknown>;
  } {
    const main = conv.getDialog('MAIN') as ReturnType<AgentSession['mainDialog']> | null;
    if (!main) throw new Error('Conversation has no MAIN dialog');
    return main;
  }

  /** The MAIN messaging dialog id (for raw UMS sends like secure-form invitations). */
  mainDialogId(conversationId: string): string {
    return this.mainDialog(this.getConversation(conversationId)).dialogId;
  }

  /** Consumer id + skill for a conversation (used by secure forms). */
  conversationMeta(conversationId: string): { consumerId: string | null; skillId: string | null } {
    const conv = this.getConversation(conversationId);
    return {
      consumerId: participantId(conv.consumer),
      skillId: conv.skill?.skillId != null ? String(conv.skill.skillId) : null,
    };
  }

  /** All skill ids this agent's conversations touch (for listing forms by skill). */
  allSkillIds(): string[] {
    return [...this.skillsById.keys()];
  }

  // ── Agent notes (conversation Note field) ──────────────────────────────────

  /** Parsed agent notes on a conversation (newest first). */
  getNotes(conversationId: string): Array<{ agentId: string; name: string; noteContent: string; time: number; noteId: string; isAutoSummary?: boolean }> {
    const conv = this.getConversation(conversationId);
    if (!conv.note) return [];
    try {
      const arr = JSON.parse(conv.note) as Array<Record<string, unknown>>;
      return (Array.isArray(arr) ? arr : [])
        .map((n) => ({
          agentId: String(n.agentId ?? ''),
          name: String(n.name ?? ''),
          noteContent: String(n.noteContent ?? ''),
          time: typeof n.time === 'number' ? n.time : 0,
          noteId: String(n.noteId ?? ''),
          isAutoSummary: Boolean(n.isAutoSummary),
        }))
        .sort((a, b) => b.time - a.time);
    } catch {
      return [];
    }
  }

  /** Add/replace THIS agent's note (the SDK retains other agents' notes + auto-summary). */
  async setAgentNote(conversationId: string, noteContent: string): Promise<void> {
    await this.getConversation(conversationId).setAgentNote({ noteContent, name: this.loginName });
  }

  /** Change agent availability state (ONLINE | AWAY | BACK_SOON | OFFLINE). */
  async changeAgentState(state: 'ONLINE' | 'AWAY' | 'BACK_SOON' | 'OFFLINE'): Promise<void> {
    await this.connection.setAgentState({ agentId: this.agentId, agentState: (AgentState as Record<string, string>)[state] });
    this.agentState = state;
    this.emit('agentState', state);
  }

  /** Send all open conversations back to queue, then go OFFLINE. */
  async returnToQueue(): Promise<void> {
    const convs = this.listConversations().filter(c => c.assignedAgentId === this.agentId);
    await Promise.allSettled(convs.map(c => this.backToQueue(c.conversationId)));
    await this.changeAgentState('OFFLINE');
  }

  // ── SDEs (customer info from conversation context) ─────────────────────────

  /** Structured Data Events for the consumer — name, contact, geo, etc. Returns the
   * raw lp_sdes array from the authenticated context, plus useful context fields
   * (visitorId/sessionId/clientProperties) that exist even for unauthenticated
   * visitors. Returns { sdes, context } so the UI can show whatever's available. */
  getSdes(conversationId: string): { sdes: unknown[]; context: Record<string, unknown> } {
    const conv = this.getConversation(conversationId);
    const ctx = (conv.context as Record<string, unknown> | null) ?? {};
    dbg('[sdes] raw context:', JSON.stringify(ctx).slice(0, 1500));
    const authed = ctx.authenticatedData as Record<string, unknown> | undefined;
    const sdes = (authed?.lp_sdes ?? (ctx as { sdes?: unknown }).sdes) as unknown;
    return { sdes: Array.isArray(sdes) ? sdes : [], context: ctx };
  }

  /** Send a text message to the MAIN messaging dialog. */
  async sendText(conversationId: string, text: string): Promise<{ sequence: number }> {
    return this.mainDialog(this.getConversation(conversationId)).sendMessage(text);
  }

  /** Upload a file to the MAIN messaging dialog. */
  async uploadFile(conversationId: string, buffer: Buffer, caption?: string): Promise<unknown> {
    // The SDK requires a true ArrayBuffer (it type-checks the arg) — a Node Buffer
    // is rejected with "buffer has to be an ArrayBuffer". Copy the exact bytes into
    // a fresh ArrayBuffer (avoids the Buffer's shared backing pool).
    const ab = new ArrayBuffer(buffer.byteLength);
    new Uint8Array(ab).set(buffer);
    return this.mainDialog(this.getConversation(conversationId)).uploadFile(ab, caption);
  }

  /** Download a hosted file by its storage relativePath. Returns the raw bytes. */
  async downloadFile(relativePath: string): Promise<{ data: Buffer; filename: string | null }> {
    const { data, filename } = await this.connection._downloadFile(relativePath);
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
    return { data: buf, filename: filename ?? null };
  }

  /** Close (end) a conversation. */
  async closeConversation(conversationId: string): Promise<void> {
    await this.getConversation(conversationId).close();
  }

  /**
   * Transfer a conversation. Pass a skillId to route to another queue, or an
   * agentId to assign a specific agent. "Back to queue" = transfer to the
   * conversation's current skill with no agent (un-assigns the current agent).
   */
  async transferConversation(
    conversationId: string,
    opts: { skillId?: string | null; agentId?: string | null },
  ): Promise<void> {
    await this.getConversation(conversationId).transfer(opts);
  }

  /** Return a conversation to its skill queue (un-assign current agent). */
  async backToQueue(conversationId: string): Promise<void> {
    const conv = this.getConversation(conversationId);
    const skillId = conv.skill?.skillId ?? null;
    await conv.transfer({ skillId, agentId: null });
  }

  /** Send an agent-only private message (not visible to the consumer). */
  async sendPrivate(conversationId: string, text: string): Promise<{ sequence: number }> {
    return this.getConversation(conversationId).sendPrivateMessage(text);
  }

  /** Known skills (id → name) for transfer targets. */
  listSkills(): Array<{ id: string; name: string }> {
    return [...this.skillsById.entries()].map(([id, name]) => ({ id, name }));
  }

  /** Agents and managers from AC users API. Role: 'Agent' | 'AgentManager'. */
  async listAgents(): Promise<
    Array<{
      id: string;
      loginName: string;
      displayName: string;
      role: string;
      status: string;
      isBot: boolean;
      skills: Array<{ id: string; name: string }>;
    }>
  > {
    const c = this.connection;
    if (!c) throw new Error('Not connected');
    const bearer = await c.getToken();

    // ROSTER: all LP users (humans + bots) with their skills + type, from le-users.
    const { resolveDomain } = await import('./csds.js');
    const domain = await resolveDomain(this.accountId, 'accountConfigReadOnly');
    const url = `https://${domain}/api/account/${encodeURIComponent(this.accountId)}/configuration/le-users/users?v=4.0&select=$all`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`AC users API failed (${res.status})`);
    const body = (await res.json()) as Array<{
      id?: unknown;
      loginName?: string;
      fullName?: string;
      nickname?: string;
      userTypeId?: number; // 1 = human agent, 2 = bot
      deleted?: boolean;
      isApiUser?: boolean;
      isEnabled?: boolean;
      profiles?: Array<{ roleTypeId?: number; name?: string }>;
      profileIds?: Array<number | string>;
      managedAgentGroups?: unknown[];
      managerOf?: unknown[];
      skills?: Array<{ id?: unknown; name?: string }>;
      skillIds?: Array<number | string>;
    }>;
    if (body[0]) {
      console.log('[agents] sample user keys:', Object.keys(body[0]).join(','));
      console.log('[agents] sample profiles:', JSON.stringify(body[0].profiles ?? body[0].profileIds ?? null).slice(0, 200));
    }
    // Build a profileId → roleTypeId map from any user's expanded `profiles` so we
    // can classify managers even when other users only carry `profileIds`.
    const profileRole = new Map<string, number>();
    for (const u of body) {
      for (const p of u.profiles ?? []) {
        // The expanded profile carries its own id under various keys.
        const pid = (p as { id?: unknown }).id;
        if (pid != null && p.roleTypeId != null) profileRole.set(String(pid), p.roleTypeId);
      }
    }

    // STATUS: live availability, joined by NAME (the availability agentId ≠ le-users
    // id, but agentName matches fullName/nickname). null → status UNKNOWN.
    const { fetchLiveAgents } = await import('./agent-status.js');
    const live = await fetchLiveAgents(this.accountId, bearer);
    const norm = (s: string) => s.trim().toLowerCase();
    const statusByName = new Map<string, string>();
    if (live) for (const a of live) if (a.agentName) statusByName.set(norm(a.agentName), a.status);

    const out = body
      // Keep humans (userTypeId 1) and bots (userTypeId 2). Bots are flagged as
      // isApiUser, so only exclude API users that are NOT bots. Drop deleted/disabled.
      .filter(
        (u) =>
          u.loginName &&
          u.deleted !== true &&
          u.isEnabled !== false &&
          (u.userTypeId === 2 || u.isApiUser !== true),
      )
      .map((u) => {
        const display = u.fullName || u.nickname || u.loginName || '';
        // Manager if: an expanded profile is roleTypeId 3, OR a profileId resolves to
        // roleTypeId 3, OR the user manages any agent group.
        const isManager =
          (u.profiles ?? []).some((p) => p.roleTypeId === 3) ||
          (u.profileIds ?? []).some((pid) => profileRole.get(String(pid)) === 3) ||
          (Array.isArray(u.managedAgentGroups) && u.managedAgentGroups.length > 0) ||
          (Array.isArray(u.managerOf) && u.managerOf.length > 0);
        const status = live
          ? statusByName.get(norm(display)) ??
            statusByName.get(norm(u.nickname ?? '')) ??
            statusByName.get(norm(u.fullName ?? '')) ??
            'OFFLINE'
          : 'UNKNOWN';
        return {
          id: String(u.id ?? ''),
          loginName: u.loginName ?? '',
          displayName: display,
          role: isManager ? 'AgentManager' : 'Agent',
          status,
          isBot: u.userTypeId === 2,
          // Prefer the full skills array; fall back to skillIds resolved via the
          // account skill-name map (the list endpoint often returns only skillIds).
          skills: (u.skills?.length
            ? u.skills.filter((s) => s.name).map((s) => ({ id: String(s.id ?? ''), name: s.name ?? '' }))
            : (u.skillIds ?? []).map((sid) => ({
                id: String(sid),
                name: this.skillsById.get(String(sid)) ?? `#${sid}`,
              }))),
        };
      });
    const loggedIn = out.filter((a) => a.status !== 'OFFLINE' && a.status !== 'UNKNOWN').length;
    console.log(
      `[agents] roster=${out.length} bots=${out.filter((a) => a.isBot).length} loggedIn=${loggedIn} (avail=${live?.length ?? 'n/a'})`,
    );
    return out;
  }

  /**
   * Full message history for a conversation. With getAllMessages:true the SDK
   * populates the open dialog's in-memory `messages` on subscribe; we also call
   * queryMessages() to backfill anything not yet loaded, then return sorted.
   */
  async getMessages(conversationId: string): Promise<ClientMessage[]> {
    const conv = this.getConversation(conversationId);
    // ALWAYS the MAIN messaging dialog — never openDialog (which becomes the COBROWSE
    // dialog after a call invite; querying that triggers "no conversation to send for MCCA").
    const main = this.mainDialog(conv);
    const readCache = () => (main.messages as Message[] | undefined) ?? [];

    // With getAllMessages:true the SDK usually populated the cache on subscribe.
    if (readCache().length <= 1 && typeof main.queryMessages === 'function') {
      try {
        await main.queryMessages({ sequenceMin: -1 }); // newerThanSequence:-1 → include seq 0
      } catch (err) {
        console.warn(`[getMessages] ${conversationId} MAIN=${main.dialogId}: ${err instanceof Error ? err.message : err}`);
      }
    }

    return readCache()
      .filter((m) => m && typeof m.body !== 'undefined')
      .sort((a, b) => a.sequence - b.sequence)
      .map((m) => this.viewMessage(conv, m));
  }

  listConversations(): ClientConversation[] {
    return this.connection.getAllKnownConversations().map((c) => this.viewConversation(c));
  }

  /**
   * Opens the connection and sets the agent ONLINE. Resolves once connected.
   *
   * The SDK's open() awaits full connection, but because maintainConnection is on
   * by default it does NOT reject on an auth failure — it emits 'failed-to-connect'
   * and retries silently forever. So we race open() against 'failed-to-connect' and
   * a hard timeout so a bad token surfaces as an error instead of hanging.
   */
  async start(timeoutMs = 20_000): Promise<void> {
    const c = this.connection;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onFail = (reject: (e: Error) => void) => () => reject(new Error(this.lastError ?? 'failed-to-connect'));
    let failHandler: (() => void) | undefined;
    const failed = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Connection timed out after ${timeoutMs}ms`)), timeoutMs);
      failHandler = onFail(reject);
      c.once('failed-to-connect', failHandler);
    });
    // Avoid an unhandled rejection if open() wins the race and `failed` rejects later.
    failed.catch(() => {});

    try {
      await Promise.race([c.open(), failed]);
    } finally {
      if (timer) clearTimeout(timer);
      if (failHandler) c.off?.('failed-to-connect', failHandler);
    }
    this.connected = true;

    // Load skill names + account language in parallel (non-fatal if either fails).
    try {
      const bearer = await c.getToken();
      const [skills, lang] = await Promise.all([
        loadSkills(this.accountId, bearer),
        fetchAccountLanguage(this.accountId, bearer),
      ]);
      this.skillsById = skills;
      this.accountLang = lang;
    } catch (err) {
      this.lastError = `startup metadata failed: ${err instanceof Error ? err.message : String(err)}`;
    }

    try {
      await c.setAgentState({ agentState: AgentState.ONLINE });
    } catch (err) {
      // Non-fatal: connection is up even if state set fails.
      this.lastError = `setAgentState failed: ${err instanceof Error ? err.message : String(err)}`;
    }

    // The initial conversation batch streams in over the first moment after connect.
    // Treat anything arriving after a short grace window as a genuine new assignment
    // worth notifying about (not just login hydration).
    setTimeout(() => {
      this.hydrating = false;
    }, 3000);
  }

  async stop(): Promise<void> {
    try {
      await this.connection.close();
    } catch {
      /* ignore */
    }
  }
}

/** In-memory session registry keyed by sessionId cookie. */
const sessions = new Map<string, AgentSession>();

export function addSession(s: AgentSession): void {
  sessions.set(s.id, s);
}
export function getSession(id: string | undefined): AgentSession | undefined {
  return id ? sessions.get(id) : undefined;
}
export async function removeSession(id: string): Promise<void> {
  const s = sessions.get(id);
  if (s) {
    sessions.delete(id);
    await s.stop();
  }
}
