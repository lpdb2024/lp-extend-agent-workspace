/**
 * Minimal ambient typings for `lp-messaging-sdk` (the official LivePerson Messaging
 * Platform SDK, npm `lp-messaging-sdk`). The package ships no .d.ts, so we declare
 * only the surface this POC uses. Derived by reading lib/ in v1.20.2.
 */
declare module 'lp-messaging-sdk' {
  export interface AuthData {
    /** username+password brand auth */
    username?: string;
    password?: string;
    /** OAuth1 */
    appKey?: string;
    secret?: string;
    accessToken?: string;
    accessTokenSecret?: string;
    /** SSO — SAML assertion */
    assertion?: string;
  }

  export interface CreateConnectionOptions {
    appId: string;
    accountId: string;
    userType: string; // UserType.BRAND
    /** Username/password (or OAuth) — SDK does the agentVep login itself. */
    authData?: AuthData;
    /** Pre-created agentVep session: { csrf, token, sessionId }. */
    authAgentSessionData?: { csrf: string; token: string; sessionId: string };
    /** Bring-your-own token maintainer (for SSO/Sentinel bearer). */
    tokenMaintainer?: unknown;
    agentId?: string;
    connectionType?: string;
    /** Populate all messages on the active dialog when a conversation arrives. */
    getAllMessages?: boolean;
    /** Override the default conversation subscription (agentId, stage, lastUpdateAfter…). */
    defaultSubscriptionQuery?: {
      agentId?: string;
      consumerId?: string;
      stage?: string[];
      state?: string[];
      lastUpdateAfter?: number;
      lastUpdateBefore?: number;
    };
  }

  /** A UMS websocket request frame: { type, body, metadata? } */
  export interface WsApiRequest {
    type: string;
    body?: Record<string, unknown>;
    metadata?: unknown[];
  }

  export interface Participant {
    id?: string;
    userId?: string;
    role?: string;
    state?: string;
    chatState?: string;
    [k: string]: unknown;
  }

  export interface Skill {
    skillId: string;
    [k: string]: unknown;
  }

  export interface Message {
    sequence: number;
    time: number;
    body: string;
    contentType: string;
    messageAudience: string;
    metadata: unknown[] | null;
    participant: Participant | null;
    isDownloadable: boolean;
    [k: string]: unknown;
  }

  export interface Conversation {
    conversationId: string;
    readonly assignedAgent: Participant | null;
    readonly consumer: Participant | null;
    skill: Skill | null;
    stage: string | null;
    ttrType: string | null;
    ttrValue: number | null;
    ttrEffective: number | null;
    startTime: number | null;
    updateTime: number | null;
    context: Record<string, unknown> | null;
    /** Per-participant unread counts: { userId: count }. */
    numberOfunreadMessages: Record<string, number> | null;
    getLatestConsumerMessage(): Message | null;
    join(participantRole: string): Promise<void>;
    leave(): Promise<void>;
    sendMessage(text: string, metadata?: unknown, quickReplies?: unknown): Promise<{ sequence: number }>;
    sendPrivateMessage(text: string, metadata?: unknown): Promise<{ sequence: number }>;
    sendRichText(message: unknown, metadata?: unknown, quickReplies?: unknown): Promise<{ sequence: number }>;
    uploadFile(buffer: Buffer | ArrayBuffer, caption?: string): Promise<unknown>;
    downloadFile(relativePath: string): Promise<unknown>;
    transfer(opts: { agentId?: string | null; skillId?: string | null }): Promise<void>;
    close(): Promise<void>;
    setNote(note: string): Promise<void>;
    /** Current note field — JSON-stringified array of agent notes (or null). */
    note: string | null;
    /** Add/replace this agent's note, retaining others. Returns truncation info. */
    setAgentNote(opts: {
      noteContent: string;
      agentId?: string | null;
      name?: string | null;
      noteId?: string | null;
      isAutoSummary?: boolean;
      truncateEnabled?: boolean;
    }): Promise<{ truncated: boolean; truncatedText?: string }>;
    queryMessages(query?: Record<string, unknown>): Promise<Message[]>;
    on(event: string, listener: (...args: any[]) => void): this;
    off(event: string, listener: (...args: any[]) => void): this;
    openDialog: { dialogId: string; messages?: Message[]; [k: string]: unknown } | null;
    getDialog(type: string): { dialogId: string; messages?: Message[]; [k: string]: unknown } | null;
    [k: string]: unknown;
  }

  export interface Connection {
    accountId: string;
    agentId?: string;
    open(): Promise<void>;
    close(): Promise<void>;
    /** SDK-managed bearer for our own server-side REST calls */
    getToken(): Promise<string>;
    /** Download a hosted file by its storage relativePath. */
    _downloadFile(relativePath: string): Promise<{ data: ArrayBuffer | Buffer; filename: string | null }>;
    /** Arbitrary UMS request escape hatch */
    send(request: WsApiRequest): Promise<unknown>;
    setAgentState(opts: { agentId?: string; agentState: string }): Promise<unknown>;
    subscribeExConversations?(query: Record<string, unknown>): Promise<unknown>;
    getAllKnownConversations(): Conversation[];
    getConversationById(conversationId: string): Conversation | null;
    on(event: string, listener: (...args: any[]) => void): this;
    once(event: string, listener: (...args: any[]) => void): this;
    off(event: string, listener: (...args: any[]) => void): this;
    emit(event: string, ...args: unknown[]): boolean;
    api?: { version?: string };
    [k: string]: unknown;
  }

  export function createConnection(opts: CreateConnectionOptions): Connection;

  export const UserType: { BRAND: string; CONSUMER: string };
  export const AgentState: { ONLINE: string; OFFLINE: string; AWAY: string; BACK_SOON: string };
  export const ParticipantRole: {
    CONSUMER: string; ASSIGNED_AGENT: string; AGENT: string; MANAGER: string;
    READER: string; BRAND_BOT: string; CONTROLLER: string;
  };
  export const ConnectionState: Record<string, string>;
  export const ConnectionType: { WEBSOCKET: string; REST: string; NULL: string };
  export const ContentType: { PLAIN_TEXT: string; HOSTED_FILE: string; RICH_TEXT: string };
  export const CSDS: any;
  export const rest: any;

  const _default: {
    createConnection: typeof createConnection;
    UserType: typeof UserType;
    AgentState: typeof AgentState;
    ParticipantRole: typeof ParticipantRole;
    ConnectionState: typeof ConnectionState;
    ConnectionType: typeof ConnectionType;
    ContentType: typeof ContentType;
    CSDS: typeof CSDS;
    rest: typeof rest;
  };
  export default _default;
}
