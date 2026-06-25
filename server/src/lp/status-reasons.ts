import { resolveDomain } from './csds.js';

/** An agent away/back-soon status reason from the AC Status Reasons API. */
export interface StatusReason {
  id: string;
  text: string;
  /** 'AWAY' | 'BACK_SOON' — which state this reason belongs to. */
  type: 'AWAY' | 'BACK_SOON';
  enabled: boolean;
}

interface CacheEntry { reasons: StatusReason[]; at: number; }
const cache = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60 * 1000;

export async function loadStatusReasons(accountId: string, bearer: string): Promise<StatusReason[]> {
  const hit = cache.get(accountId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.reasons;

  const domain = await resolveDomain(accountId, 'accountConfigReadOnly');
  const url = `https://${domain}/api/account/${encodeURIComponent(accountId)}/configuration/le-agents/status-reasons?v=1.0`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' } });
  let reasons: StatusReason[] = [];
  if (res.ok) {
    const raw = (await res.json()) as Array<{ id?: string | number; text?: string; type?: string; state?: string; enabled?: boolean; deleted?: boolean }>;
    const toType = (v: string | undefined): 'AWAY' | 'BACK_SOON' | null => {
      const u = (v ?? '').toUpperCase().replace(/\s+/g, '_');
      if (u === 'AWAY') return 'AWAY';
      if (u === 'BACK_SOON' || u === 'BACKSOON' || u === 'BACK-SOON') return 'BACK_SOON';
      return null;
    };
    for (const r of raw) {
      if (r.enabled === false || r.deleted === true) continue;
      const type = toType(r.state ?? r.type);
      if (!type) continue;
      reasons.push({ id: String(r.id ?? ''), text: r.text ?? '', type, enabled: true });
    }
  }
  cache.set(accountId, { reasons, at: Date.now() });
  return reasons;
}

/** Invalidate cache for an account (e.g. after config changes). */
export function invalidateStatusReasonCache(accountId: string): void {
  cache.delete(accountId);
}
