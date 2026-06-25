import { resolveDomain } from './csds.js';

/**
 * Agent availability — the live status CCUI itself uses.
 * POST {agentManagerWorkspace}/manager_workspace/api/account/{id}/agent/availability
 *      ?source=ccui&offset=N&limit=50
 * Body: { filters: {}, metricsToRetrieveCurrentValue: ["agent_current_status",
 *                                                       "agent_current_status_reason"] }
 *
 * Domain: CSDS service `agentManagerWorkspace`. Auth: the agent's bearer.
 * Response: { metadata: { count, next? }, agentRecords: [ { agentId, agentName,
 *   agentCurrentStatus, agentCurrentStatusReasonId, isDeactivated } ] }.
 * agentCurrentStatus is ONLINE / OCCUPIED / AWAY / BACK_SOON / OFFLINE; only
 * logged-in agents are returned. Paginated (limit 50) — we follow `next`.
 */

export type AgentAvailability = 'ONLINE' | 'OCCUPIED' | 'AWAY' | 'BACK_SOON' | 'OFFLINE';

/** A live agent as returned by the availability API — the roster CCUI shows. */
export interface LiveAgent {
  agentId: string;
  agentName: string;
  status: AgentAvailability;
}

interface AgentRecord {
  agentId?: string;
  agentName?: string;
  agentCurrentStatus?: string;
  isDeactivated?: boolean;
}

function normalizeStatus(raw: unknown): AgentAvailability {
  const s = String(raw ?? '').toUpperCase().replace(/[\s-]/g, '_');
  if (s.includes('OCCUP')) return 'OCCUPIED';
  if (s.includes('BACK')) return 'BACK_SOON';
  if (s.includes('AWAY')) return 'AWAY';
  if (s.includes('OFFLINE')) return 'OFFLINE';
  return 'ONLINE';
}

/**
 * Fetch the full live agent roster (paginated). This is the same list CCUI shows in
 * its transfer/availability views. Returns null on failure.
 */
export async function fetchLiveAgents(accountId: string, bearer: string): Promise<LiveAgent[] | null> {
  try {
    const domain = await resolveDomain(accountId, 'agentManagerWorkspace');
    const base = `https://${domain}/manager_workspace/api/account/${encodeURIComponent(accountId)}/agent/availability?source=ccui&limit=50`;
    const body = JSON.stringify({
      filters: {},
      metricsToRetrieveCurrentValue: ['agent_current_status', 'agent_current_status_reason'],
    });
    const out: LiveAgent[] = [];
    let offset = 0;
    let total = Infinity;
    while (offset < total && offset < 2000) {
      const res = await fetch(`${base}&offset=${offset}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${bearer}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body,
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        console.warn(`[agent-status] availability HTTP ${res.status}: ${t.slice(0, 200)}`);
        return offset > 0 ? out : null;
      }
      const data = (await res.json()) as {
        metadata?: { count?: number; next?: unknown };
        agentRecords?: AgentRecord[];
      };
      const records = data.agentRecords ?? [];
      for (const r of records) {
        if (!r.agentId) continue;
        out.push({
          agentId: String(r.agentId),
          agentName: r.agentName ?? '',
          status: r.isDeactivated ? 'OFFLINE' : normalizeStatus(r.agentCurrentStatus),
        });
      }
      total = typeof data.metadata?.count === 'number' ? data.metadata.count : records.length;
      if (!records.length || !data.metadata?.next) break;
      offset += 50;
    }
    const online = out.filter((a) => a.status === 'ONLINE' || a.status === 'OCCUPIED').length;
    console.log(`[agent-status] availability → ${out.length} agents, ${online} online/occupied`);
    return out;
  } catch (err) {
    console.warn('[agent-status] error:', err instanceof Error ? err.message : err);
    return null;
  }
}
