import type { AgentSession } from './connection.js';
import { resolveDomain } from './csds.js';
import { dbg } from './debug.js';

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

export interface PageView {
  page: string;
  title: string | null;
  referrer: string | null;
  sections: string[];
  visitTime: number | null;
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
  agentType: string | null; // 'Bot' | 'Human' | 'System'
  summary: string | null;
  isActive: boolean;
}

interface ConvRecord {
  info?: Record<string, unknown>;
  monitoring?: Record<string, unknown>;
  consumerParticipants?: Array<Record<string, unknown>>;
  pageView?: Array<Record<string, unknown>>;
  campaign?: Record<string, unknown>;
  sdes?: { events?: Array<Record<string, unknown>> };
  unAuthSdes?: { events?: Array<Record<string, unknown>> };
  transfers?: Array<Record<string, unknown>>;
  interactions?: Array<Record<string, unknown>>;
  agentParticipants?: Array<Record<string, unknown>>;
  messageRecords?: Array<Record<string, unknown>>;
  summary?: { text?: string; lastUpdatedTime?: number };
}

async function msgHistDomain(accountId: string): Promise<string> {
  for (const svc of ['msgHist', 'msgHistES']) {
    try {
      return await resolveDomain(accountId, svc);
    } catch {
      /* try next */
    }
  }
  const anyDomain = await resolveDomain(accountId, 'agentVep');
  const region = anyDomain.split('.')[0];
  return `${region}.msghist.liveperson.net`;
}

const CONTENT_TO_RETRIEVE = [
  'campaign', 'messageRecords', 'agentParticipants', 'agentParticipantsLeave',
  'agentParticipantsActive', 'consumerParticipants', 'transfers', 'interactions',
  'messageScores', 'messageStatuses', 'conversationSurveys', 'coBrowseSessions',
  'summary', 'sdes', 'unAuthSdes', 'monitoring', 'dialogs', 'responseTime',
  'skillChanges', 'intents', 'uniqueIntents', 'latestAgentSurvey',
  'previouslySubmittedAgentSurveys', 'pageViews',
];

async function fetchRecord(session: AgentSession, conversationId: string): Promise<ConvRecord | null> {
  const accountId = session.accountId;
  const bearer = await session.connection.getToken();
  const domain = await msgHistDomain(accountId);
  const url = `https://${domain}/messaging_history/api/account/${accountId}/conversations/conversation/search?v=2&source=ccui&limit=1&offset=0`;
  dbg('[msg-int] POST', url, 'conv=', conversationId);
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ conversationId, contentToRetrieve: CONTENT_TO_RETRIEVE }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`msg-int HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { conversationHistoryRecords?: ConvRecord[] };
  return json.conversationHistoryRecords?.[0] ?? null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : v != null ? String(v) : null);

export interface ConvDetail {
  info: CustomerInfo;
  pages: PageView[];
  sdes: SdeEvent[];
  timeline: TimelineSegment[];
}

export async function getConvDetail(session: AgentSession, conversationId: string): Promise<ConvDetail | null> {
  const rec = await fetchRecord(session, conversationId);
  if (!rec) return null;

  const info = rec.info ?? {};
  const mon = rec.monitoring ?? {};
  const consumer = rec.consumerParticipants?.[0] ?? {};
  const camp = rec.campaign ?? {};

  const resolvedName = str(consumer.consumerName ?? consumer.firstName);
  if (resolvedName) session.consumerNameCache.set(conversationId, resolvedName);
  const resolvedChannel = str(info.source);
  if (resolvedChannel) session.channelCache.set(conversationId, resolvedChannel);
  const updated = session.listConversations().find(c => c.conversationId === conversationId);
  if (updated) session.emit('conversation', updated);

  const customerInfo: CustomerInfo = {
    consumerName: str(consumer.consumerName ?? consumer.firstName),
    consumerId: str(consumer.participantId),
    country: str(mon.country),
    countryCode: str(mon.countryCode),
    state: str(mon.state),
    city: str(mon.city),
    isp: str(mon.isp),
    org: str(mon.org),
    ipAddress: str(mon.ipAddress ?? info.ipAddress),
    device: str(info.device ?? mon.device),
    browser: str(info.browser ? `${info.browser} ${info.browserVersion ?? ''}`.trim() : mon.browser),
    operatingSystem: str(info.operatingSystem ? `${info.operatingSystem} ${info.operatingSystemVersion ?? ''}`.trim() : mon.operatingSystem),
    language: str(info.language),
    timeZone: str(info.timeZone),
    visitorId: str(info.visitorId),
    sessionId: str(info.sessionId),
    interactionContextId: str(info.interactionContextId),
    startTime: str(info.startTime),
    source: str(info.source),
    integration: str(info.integration),
    integrationVersion: str(info.integrationVersion),
    mcs: typeof info.mcs === 'number' ? info.mcs : null,
    startPage: str(mon.conversationStartPage),
    startPageTitle: str(mon.conversationStartPageTitle),
    campaignId: str(camp.campaignId),
    campaignName: str(camp.campaignName),
    goalId: str(camp.goalId),
    goalName: str(camp.goalName),
    engagementId: str(camp.campaignEngagementId),
    engagementName: str(camp.campaignEngagementName),
    engagementSource: str(camp.engagementSource),
    lobId: str(camp.lobId),
    lobName: str(camp.lobName),
    visitorBehaviorName: str(camp.visitorBehaviorName),
    visitorProfileName: str(camp.visitorProfileName),
    locationName: str(camp.locationName),
  };

  const rawPages = rec.pageView ?? [];
  const pages: PageView[] = rawPages
    .map((v) => ({
      page: str(v.page) ?? '',
      title: str(v.title),
      referrer: str(v.referrer),
      sections: Array.isArray(v.sections) ? (v.sections as string[]) : [],
      visitTime: typeof v.visitTime === 'number' ? v.visitTime : null,
    }))
    .filter((v) => v.page)
    .sort((a, b) => (a.visitTime ?? 0) - (b.visitTime ?? 0));

  // Deduplicate by sdeType+serverTimeStamp — MI often returns the same event multiple times
  const seenSde = new Set<string>();
  const allSdeEvents = [...(rec.sdes?.events ?? []), ...(rec.unAuthSdes?.events ?? [])].filter(e => {
    const key = `${e.sdeType}:${e.serverTimeStamp}`;
    if (seenSde.has(key)) return false;
    seenSde.add(key);
    return true;
  });
  // MI SDE shapes verified from API:
  // Each event: { sdeType, serverTimeStamp, <camelKey>: { serverTimeStamp, [<camelKey>]: innerData | directData } }
  // Some types double-nest (CUSTOMER_INFO, PERSONAL_INFO, LEAD, SERVICE_ACTIVITY, MARKETING_CAMPAIGN_INFO, VISITOR_ERROR)
  // Others don't (PURCHASE, CART_STATUS, VIEWED_PRODUCT, SEARCH_CONTENT)
  interface SdeSpec { key: string; inner?: string; norm: string; }
  const SDE_SPECS: Record<string, SdeSpec> = {
    CUSTOMER_INFO:          { key: 'customerInfo',        inner: 'customerInfo',        norm: 'ctmrinfo' },
    PERSONAL_INFO:          { key: 'personalInfo',        inner: 'personalInfo',        norm: 'personal' },
    LEAD:                   { key: 'lead',                inner: 'lead',                norm: 'lead' },
    SERVICE_ACTIVITY:       { key: 'serviceActivity',     inner: 'serviceActivity',     norm: 'service' },
    MARKETING_CAMPAIGN_INFO:{ key: 'marketingCampaignInfo', inner: 'marketingCampaignInfo', norm: 'mrktInfo' },
    VISITOR_ERROR:          { key: 'visitorError',        inner: 'visitorError',        norm: 'error' },
    PURCHASE:               { key: 'purchase',            norm: 'purchase' },
    CART_STATUS:            { key: 'cartStatus',          norm: 'cart' },
    VIEWED_PRODUCT:         { key: 'viewedProduct',       norm: 'viewedProduct' },
    SEARCH_CONTENT:         { key: 'searchContent',       norm: 'searchInfo' },
  };
  const sdes: SdeEvent[] = allSdeEvents.map((e) => {
    const rawType = str(e.sdeType ?? e.eventType) ?? 'unknown';
    const spec = SDE_SPECS[rawType];
    const norm = spec?.norm ?? rawType.toLowerCase();
    let data: Record<string, unknown> = {};
    if (spec) {
      const outer = (e[spec.key] ?? {}) as Record<string, unknown>;
      data = spec.inner ? (outer[spec.inner] ?? outer) as Record<string, unknown> : outer;
    }
    return {
      type: norm,
      data,
      serverTimeStamp: typeof e.serverTimeStamp === 'number' ? e.serverTimeStamp : typeof e.serverTimeStamp === 'string' ? Number(e.serverTimeStamp) : null,
    };
  });

  // Build agent lookup: agentId -> { nickname, userTypeName }
  const agentById = new Map<string, { name: string; userTypeName: string }>();
  for (const a of rec.agentParticipants ?? []) {
    const id = str(a.agentId);
    if (id) agentById.set(id, { name: str(a.agentNickname ?? a.agentFullName) ?? id, userTypeName: str(a.userTypeName) ?? '' });
  }

  // Build per-segment summaries: map interaction startTimeL -> summary text
  // Summary messages have audience=AGENTS_AND_MANAGERS and ConversationSummary in rawMetadata
  const summaryByTime = new Map<number, string>();
  for (const m of rec.messageRecords ?? []) {
    if (m.audience !== 'AGENTS_AND_MANAGERS') continue;
    const raw = str(m.contextData ? (m.contextData as Record<string, unknown>).rawMetadata : null) ?? '';
    if (!raw.includes('ConversationSummary')) continue;
    const text = str((m.messageData as Record<string, unknown>)?.msg ? ((m.messageData as Record<string, unknown>).msg as Record<string, unknown>)?.text : null);
    if (text) summaryByTime.set(typeof m.timeL === 'number' ? m.timeL : 0, text);
  }

  // Build timeline: one segment per interaction, attach nearest summary
  const interactions = [...(rec.interactions ?? [])].sort(
    (a, b) => (typeof a.interactionTimeL === 'number' ? a.interactionTimeL : 0) - (typeof b.interactionTimeL === 'number' ? b.interactionTimeL : 0),
  );
  const transfers = [...(rec.transfers ?? [])].sort(
    (a, b) => (typeof a.timeL === 'number' ? a.timeL : 0) - (typeof b.timeL === 'number' ? b.timeL : 0),
  );

  // Map each interaction to a skill: use transfer records to know what skill was active
  const timeline: TimelineSegment[] = interactions.map((ix, idx) => {
    const startL = typeof ix.interactionTimeL === 'number' ? ix.interactionTimeL : 0;
    const endL = idx + 1 < interactions.length ? (typeof interactions[idx + 1].interactionTimeL === 'number' ? interactions[idx + 1].interactionTimeL as number : Infinity) : Infinity;

    // Find the transfer that happened just before or at this interaction start
    const transfer = [...transfers].reverse().find(t => (typeof t.timeL === 'number' ? t.timeL : 0) <= startL);
    const skillName = transfer ? str(transfer.targetSkillName) : str(info.latestSkillName ?? rec.info?.latestSkillName);

    const agentId = str(ix.assignedAgentId);
    const agent = agentId ? agentById.get(agentId) : null;

    // Find summary message within this segment's time window
    let summary: string | null = null;
    for (const [t, text] of summaryByTime) {
      if (t >= startL && t < endL) { summary = text; break; }
    }

    return {
      startTimeL: startL,
      skillName: skillName ?? null,
      agentName: agent?.name ?? str(ix.assignedAgentNickname ?? ix.assignedAgentFullName),
      agentType: agent?.userTypeName ?? null,
      summary,
      isActive: false, // set below
    };
  });

  // If no interactions, create one segment from conversation start
  if (timeline.length === 0) {
    timeline.push({
      startTimeL: typeof info.startTimeL === 'number' ? info.startTimeL : 0,
      skillName: str(info.latestSkillName),
      agentName: str(info.latestAgentNickname),
      agentType: null,
      summary: null,
      isActive: false,
    });
  }
  // Mark last segment as active (current)
  if (timeline.length > 0) timeline[timeline.length - 1].isActive = true;

  return { info: customerInfo, pages, sdes, timeline };
}

/** Summary of a past conversation shown in the history ribbon. */
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

/** Search MI API for all conversations by consumerId, excluding the current one.
 *  Returns up to 50 most-recent closed conversations sorted newest first. */
export async function getConsumerHistory(
  session: AgentSession,
  consumerId: string,
  excludeConversationId: string,
): Promise<ConvHistorySummary[]> {
  const accountId = session.accountId;
  const bearer = await session.connection.getToken();
  const domain = await msgHistDomain(accountId);
  const url = `https://${domain}/messaging_history/api/account/${accountId}/conversations/consumer/search?source=ccuiNAWGetConvHist&offset=0&limit=50&NC=true`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      consumer: consumerId,
      status: ['CLOSE'],
      contentToRetrieve: ['messageRecords', 'agentParticipants', 'consumerParticipants', 'messageStatuses', 'dialogs', 'sdes', 'summary', 'latestAgentSurvey'],
      cappingConfiguration: 'PersonalInfoEvent:1:desc,CustomerInfoEvent:1:desc',
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`consumer history HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { conversationHistoryRecords?: Array<Record<string, unknown>> };
  const records = json.conversationHistoryRecords ?? [];

  return records
    .filter((r) => {
      const info = r.info as Record<string, unknown> | undefined;
      return str(info?.conversationId) !== excludeConversationId;
    })
    .map((r) => {
      const info = (r.info ?? {}) as Record<string, unknown>;
      const agents = (r.agentParticipants as Array<Record<string, unknown>> | undefined) ?? [];
      const lastAgent = agents.filter(a => String(a.role ?? '') !== 'MANAGER').pop();
      const msgs = (r.messageRecords as Array<unknown> | undefined) ?? [];
      const mon = (r.monitoring ?? {}) as Record<string, unknown>;
      return {
        conversationId: str(info.conversationId) ?? '',
        startTime: info.startTime != null ? Number(info.startTime) : null,
        endTime: info.endTime != null ? Number(info.endTime) : null,
        skillName: str(info.latestSkillName ?? info.skillName),
        agentName: str(lastAgent?.agentFullName ?? lastAgent?.agentNickName),
        status: str(info.status),
        messageCount: msgs.length,
        source: str(mon.channel ?? info.source),
      };
    })
    .filter(r => r.conversationId)
    .sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0));
}

/** Fetch just the message records for a historical conversation (no full ConvDetail transform). */
export async function getHistoryMessages(
  session: AgentSession,
  conversationId: string,
): Promise<Array<{ sequence: number; time: number; body: string; role: string; isFromConsumer: boolean }>> {
  const rec = await fetchRecord(session, conversationId);
  if (!rec) return [];
  const msgs = (rec.messageRecords ?? []) as Array<Record<string, unknown>>;
  dbg('[hist-msgs] raw count=', msgs.length, 'sample keys=', msgs[0] ? Object.keys(msgs[0]) : '[]');
  if (msgs[0]) dbg('[hist-msgs] first msg=', JSON.stringify(msgs[0]).slice(0, 300));

  const extractBody = (m: Record<string, unknown>): string => {
    // MI messageRecords can nest the text in several places depending on LP version/channel.
    // Try each location in priority order.
    if (typeof m.message === 'string' && m.message) return m.message;
    const md = m.messageData as Record<string, unknown> | undefined;
    if (md) {
      const msg = md.msg as Record<string, unknown> | undefined;
      if (typeof msg?.text === 'string' && msg.text) return msg.text;
      if (typeof md.msg === 'string' && md.msg) return md.msg;
    }
    if (typeof m.textData === 'string' && m.textData) return m.textData;
    if (typeof m.content === 'string' && m.content) return m.content;
    return '';
  };

  return msgs
    .filter(m => {
      const ct = str(m.type ?? m.contentType) ?? '';
      // Keep text messages; skip structured events (rich content, forms, etc.)
      return !ct || ct === 'TEXT_PLAIN' || ct === 'text/plain' || ct.startsWith('text/');
    })
    .map(m => ({
      sequence: Number(m.sequence ?? 0),
      time: Number(m.time ?? m.serverTime ?? m.timeL ?? 0),
      body: extractBody(m),
      role: str(m.participantType ?? m.role) ?? 'CONSUMER',
      isFromConsumer: (str(m.participantType ?? m.role) ?? 'CONSUMER') === 'CONSUMER',
    }))
    .filter(m => m.body)
    .sort((a, b) => a.sequence - b.sequence);
}

// Keep old exports for backward compat with routes that haven't been updated yet
export async function getCustomerInfo(session: AgentSession, conversationId: string): Promise<CustomerInfo | null> {
  const detail = await getConvDetail(session, conversationId);
  return detail?.info ?? null;
}

export async function getPageViews(session: AgentSession, conversationId: string): Promise<PageView[]> {
  const detail = await getConvDetail(session, conversationId);
  return detail?.pages ?? [];
}
