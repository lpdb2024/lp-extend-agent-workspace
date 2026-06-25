import { resolveDomain } from './csds.js';

/**
 * Resolve skill IDs -> names via the AC Skills API (accountConfigReadOnly).
 * Cached per account for the session; runs server-side with the agent bearer.
 */
interface SkillCacheEntry {
  byId: Map<string, string>;
  at: number;
}
const cache = new Map<string, SkillCacheEntry>();
const TTL_MS = 10 * 60 * 1000;

export async function loadSkills(accountId: string, bearer: string): Promise<Map<string, string>> {
  const hit = cache.get(accountId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.byId;

  const domain = await resolveDomain(accountId, 'accountConfigReadOnly');
  const url = `https://${domain}/api/account/${encodeURIComponent(accountId)}/configuration/le-users/skills?v=2.0`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' } });
  const byId = new Map<string, string>();
  if (res.ok) {
    const skills = (await res.json()) as Array<{ id?: string | number; name?: string }>;
    for (const s of skills) {
      if (s.id != null && s.name) byId.set(String(s.id), s.name);
    }
  }
  cache.set(accountId, { byId, at: Date.now() });
  return byId;
}

export function skillName(byId: Map<string, string>, skillId: string | null | undefined): string | null {
  if (skillId == null) return null;
  return byId.get(String(skillId)) ?? null;
}
