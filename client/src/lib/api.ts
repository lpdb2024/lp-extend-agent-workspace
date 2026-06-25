export type ConvStatus = 'queued' | 'active' | 'idle' | 'urgent' | 'overdue';

export interface Conversation {
  conversationId: string;
  dialogId: string | null;
  consumerId: string | null;
  consumerName: string;
  assignedAgentId: string | null;
  skillId: string | null;
  skillName: string | null;
  status: ConvStatus;
  ttrDeadline: number | null;
  ttrSecondsLeft: number | null;
  ttrType: string | null;
  startTime: number | null;
  updateTime: number | null;
  lastMessage: string | null;
  lastMessageFromConsumer: boolean;
  unread: number;
  channel: string | null;
}

export interface ChatMessage {
  conversationId: string;
  sequence: number;
  time: number;
  body: string;
  contentType: string;
  role: string;
  isFromConsumer: boolean;
  metadata: unknown[] | null;
  /** Special CONTROLLER message kinds: 'summary' (auto conversation summary card)
   * or 'auto' (centered system text). Undefined for ordinary chat messages. */
  kind?: 'summary' | 'auto';
  /** 'AGENTS_AND_MANAGERS' = private (consumer can't see it); else visible to all. */
  audience?: 'ALL' | 'AGENTS_AND_MANAGERS';
  /** Present when the message is a shared (hosted) file. */
  file?: {
    fileType: string | null; // PNG / JPG / GIF / PDF
    caption: string | null;
    relativePath: string | null;
    preview: string | null; // base64 thumbnail (images), no data: prefix
  };
  /** Present when the message is a secure-form invitation/submission. */
  secureForm?: {
    kind: 'invitation' | 'submission';
    formId: string | null;
    title: string | null;
    invitationId: string | null;
    submissionId: string | null;
  };
}

/** URL for the full hosted file (streamed via the server). */
export function fileUrl(f: { relativePath: string | null; fileType: string | null }): string {
  const qs = new URLSearchParams({ path: f.relativePath ?? '', type: f.fileType ?? '' });
  return `/api/files?${qs.toString()}`;
}

export type AgentAvailState = 'ONLINE' | 'AWAY' | 'BACK_SOON' | 'OFFLINE';

export interface StatusReason {
  id: string;
  text: string;
  type: 'AWAY' | 'BACK_SOON';
  enabled: boolean;
}

export interface Me {
  sessionId: string;
  accountId: string;
  loginName: string;
  displayName?: string;
  email?: string;
  imageUrl?: string;
  connected: boolean;
  lastError?: string | null;
  agentState?: AgentAvailState;
  skillIds?: number[];
  agentGroupName?: string;
  accountLang?: string;
  conversations: Conversation[];
}

async function j<T>(res: Response): Promise<T> {
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  loginPassword(accountId: string, username: string, password: string) {
    return fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId, username, password }),
    }).then(j<Me>);
  },
  ssoUrl(accountId: string, redirect: string) {
    const qs = new URLSearchParams({ accountId, redirect });
    return fetch(`/api/auth/login/sso/url?${qs.toString()}`).then(j<{ url: string }>);
  },
  ssoCallback(state: string, code: string, redirect: string) {
    return fetch('/api/auth/login/sso/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, code, redirect }),
    }).then(j<Me>);
  },
  me() {
    return fetch('/api/auth/me').then(j<Me>);
  },
  logout() {
    return fetch('/api/auth/logout', { method: 'POST' }).then(j<{ ok: boolean }>);
  },
  setAgentState(state: AgentAvailState) {
    return fetch('/api/auth/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    }).then(j<{ ok: boolean; agentState: AgentAvailState }>);
  },
  returnToQueue() {
    return fetch('/api/auth/return-to-queue', { method: 'POST' }).then(j<{ ok: boolean }>);
  },
  getStatusReasons() {
    return fetch('/api/auth/status-reasons').then(j<StatusReason[]>);
  },
  getMessages(id: string) {
    return fetch(`/api/conversations/${id}/messages`).then(j<{ messages: ChatMessage[] }>);
  },
  sendMessage(id: string, text: string) {
    return fetch(`/api/conversations/${id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }).then(j<{ ok: boolean; sequence: number | null }>);
  },
  sendFile(id: string, file: File, caption?: string) {
    const form = new FormData();
    form.append('file', file);
    if (caption) form.append('caption', caption);
    return fetch(`/api/conversations/${id}/file`, { method: 'POST', body: form }).then(
      j<{ ok: boolean; fileName: string }>,
    );
  },
  getNotes(id: string) {
    return fetch(`/api/conversations/${id}/notes`).then(j<{ notes: AgentNote[] }>);
  },
  saveNote(id: string, note: string) {
    return fetch(`/api/conversations/${id}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    }).then(j<{ ok: boolean; notes: AgentNote[] }>);
  },
  getSdes(id: string) {
    return fetch(`/api/conversations/${id}/sdes`).then(
      j<{ sdes: unknown[]; context: Record<string, unknown> }>,
    );
  },
  customerInfo(id: string) {
    return fetch(`/api/conversations/${id}/customer`).then(j<{ info: CustomerInfo | null; pages: PageView[]; sdes: SdeEvent[]; timeline: TimelineSegment[] }>);
  },
  pageHistory(id: string) {
    return fetch(`/api/conversations/${id}/pages`).then(j<{ pages: PageView[] }>);
  },
  predefinedContent(skills?: string) {
    const qs = skills ? `?skills=${encodeURIComponent(skills)}` : '';
    return fetch(`/api/predefined-content${qs}`).then(j<{ categories: CannedCategory[] }>);
  },
  listSecureForms(id: string) {
    return fetch(`/api/conversations/${id}/secure-forms`).then(j<{ forms: SecureFormConfig[] }>);
  },
  sendSecureForm(id: string, formId: number, formName: string) {
    return fetch(`/api/conversations/${id}/secure-form`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ formId, formName }),
    }).then(j<{ ok: boolean; invitationId: string; sequence: number | null }>);
  },
  viewSecureForm(id: string, body: { submissionId: string; invitationId: string; formId?: string; sequence?: number }) {
    return fetch(`/api/conversations/${id}/secure-form/view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(j<SecureFormView>);
  },
  startCobrowse(id: string, body: Record<string, unknown>) {
    return fetch(`/api/conversations/${id}/cobrowse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(j<{ ok: boolean; sessionKey: string }>);
  },
  stopCobrowse(sessionKey: string) {
    return fetch(`/api/cobrowse/${sessionKey}/stop`, { method: 'POST' }).then(j<{ ok: boolean }>);
  },
  skills() {
    return fetch('/api/skills').then(j<{ skills: Skill[] }>);
  },
  agents() {
    return fetch('/api/agents').then(j<{ agents: AgentUser[] }>);
  },
  prompts() {
    return fetch('/api/prompts').then(j<{ prompts: LpPrompt[] }>);
  },
  llm(prompt: string) {
    return fetch('/api/llm/invoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    }).then(j<{ text: string; promptTokens: number; completionTokens: number; totalTokens: number; generationTimeSeconds: number }>);
  },
  translate(texts: string[], targetLang?: string) {
    return fetch('/api/llm/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts, targetLang }),
    }).then(j<{ translations: string[] }>);
  },
  getConsumerHistory(id: string) {
    return fetch(`/api/conversations/${id}/history`).then(j<{ history: ConvHistorySummary[] }>);
  },
  getHistoryMessages(id: string, histId: string) {
    return fetch(`/api/conversations/${id}/history/${histId}/messages`).then(j<{ messages: HistoryMessage[] }>);
  },
  closeConversation(id: string) {
    return fetch(`/api/conversations/${id}/close`, { method: 'POST' }).then(j<{ ok: boolean }>);
  },
  backToQueue(id: string) {
    return fetch(`/api/conversations/${id}/back-to-queue`, { method: 'POST' }).then(j<{ ok: boolean }>);
  },
  transfer(id: string, target: { skillId?: string; agentId?: string }) {
    return fetch(`/api/conversations/${id}/transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(target),
    }).then(j<{ ok: boolean }>);
  },
  sendPrivate(id: string, text: string) {
    return fetch(`/api/conversations/${id}/private`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }).then(j<{ ok: boolean; sequence: number | null }>);
  },
};

export interface LpPrompt {
  id: string;
  name: string;
  clientType: string;
  description: string;
  promptHeader: string;
  status: string;
  langCode: string;
}

export interface Skill {
  id: string;
  name: string;
}

export type AgentAvailability = 'ONLINE' | 'OCCUPIED' | 'AWAY' | 'BACK_SOON' | 'OFFLINE' | 'UNKNOWN';
export interface AgentUser {
  id: string;
  loginName: string;
  displayName: string;
  role: 'Agent' | 'AgentManager';
  /** Live availability from the availability API. OFFLINE = not logged in. */
  status: AgentAvailability;
  /** userTypeId 2 = bot, 1 = human. */
  isBot: boolean;
  /** Skills the agent/bot is assigned to. */
  skills: Array<{ id: string; name: string }>;
}

export interface AgentNote {
  agentId: string;
  name: string;
  noteContent: string;
  time: number;
  noteId: string;
  isAutoSummary?: boolean;
}

export interface CannedResponse {
  id: number;
  title: string;
  text: string | null;
  enabled: boolean;
  categoryId: number | null;
  categoryName: string | null;
  hotkey?: { prefix?: string; suffix?: string } | null;
}

export interface CannedCategory {
  id: number;
  name: string;
  order: number;
  items: CannedResponse[];
}

export interface CustomerInfo {
  consumerName: string | null;
  consumerId: string | null;
  country: string | null;
  countryCode: string | null;
  state: string | null;
  city: string | null;
  isp: string | null;
  org: string | null;
  ipAddress: string | null;
  device: string | null;
  browser: string | null;
  operatingSystem: string | null;
  language: string | null;
  timeZone: string | null;
  visitorId: string | null;
  sessionId: string | null;
  interactionContextId: string | null;
  startTime: string | null;
  source: string | null;
  integration: string | null;
  integrationVersion: string | null;
  mcs: number | null;
  startPage: string | null;
  startPageTitle: string | null;
  campaignId: string | null;
  campaignName: string | null;
  goalId: string | null;
  goalName: string | null;
  engagementId: string | null;
  engagementName: string | null;
  engagementSource: string | null;
  lobId: string | null;
  lobName: string | null;
  visitorBehaviorName: string | null;
  visitorProfileName: string | null;
  locationName: string | null;
}

export interface SdeEvent {
  type: string;
  data: Record<string, unknown>;
  serverTimeStamp: number | null;
}

export interface TimelineSegment {
  startTimeL: number;
  skillName: string | null;
  agentName: string | null;
  agentType: string | null;
  summary: string | null;
  isActive: boolean;
}

export interface PageView {
  page: string;
  title: string | null;
  referrer: string | null;
  sections: string[];
  visitTime: number | null;
}

export interface SecureFormField {
  id: string;
  name: string;
  type: string;
  required: boolean;
  masked: boolean;
}
export interface SecureFormConfig {
  id: number;
  name: string;
  json: SecureFormField[];
}
export interface SecureFormView {
  ok: boolean;
  readOtk: string;
  data?: unknown;
  fetch?: { attempted: boolean; status?: number; endpoint?: string; body?: string; error?: string };
}

/** Subscribe to the main session SSE feed. Returns a close fn. */
export function subscribeEvents(handlers: {
  ready?: (d: { connected: boolean; conversations: Conversation[] }) => void;
  message?: (m: ChatMessage) => void;
  conversation?: (c: Conversation) => void;
  assigned?: (c: Conversation) => void;
  status?: (s: { connected: boolean }) => void;
  lpError?: (e: { error: string }) => void;
}): () => void {
  const es = new EventSource('/api/events');
  const on = (name: string, fn?: (d: unknown) => void) =>
    fn && es.addEventListener(name, (e) => fn(JSON.parse((e as MessageEvent).data)));
  on('ready', handlers.ready as (d: unknown) => void);
  on('message', handlers.message as (d: unknown) => void);
  on('conversation', handlers.conversation as (d: unknown) => void);
  on('assigned', handlers.assigned as (d: unknown) => void);
  on('status', handlers.status as (d: unknown) => void);
  on('lp-error', handlers.lpError as (d: unknown) => void);
  return () => es.close();
}

export interface ConvHistorySummary {
  conversationId: string;
  startTime: number | null;
  endTime: number | null;
  skillName: string | null;
  agentName: string | null;
  status: string | null;
  messageCount: number;
  source: string | null;
}

export interface HistoryMessage {
  sequence: number;
  time: number;
  body: string;
  role: string;
  isFromConsumer: boolean;
}

export function subscribeCobrowse(sessionKey: string, onEvent: (e: unknown) => void): () => void {
  const es = new EventSource(`/api/cobrowse/${sessionKey}/events`);
  es.addEventListener('cobrowse', (e) => onEvent(JSON.parse((e as MessageEvent).data)));
  return () => es.close();
}
