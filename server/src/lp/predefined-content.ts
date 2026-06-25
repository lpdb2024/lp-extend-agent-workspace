import type { AgentSession } from './connection.js';
import { resolveDomain } from './csds.js';
import { dbg } from './debug.js';

/**
 * Predefined content (canned responses) + categories — account-config REST.
 * Captured from CCUI (development/canned-response.categories.md).
 *
 *  - Categories: GET {ac}/api/account/{id}/configuration/le-categories/categories
 *                    ?v=2.0&select=$all&return=active   → [{ id, name, order }]
 *  - Canned:     GET {acr}/api/account/{id}/configuration/engagement-window/canned-responses
 *                    ?v=2.0&select=$all&source=ccuiNAWGetPredContent&group_by=CATEGORIES&skill_ids=…
 *
 * 🔑 `select=$all` is what returns the BODY (`data[].msg`) and the hotkey — the
 *    trimmed select used before omitted them. The canned list is on the **acr** host.
 */

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

interface RawCategory {
  id: number;
  name: string;
  order?: number;
  deleted?: boolean;
}

interface RawCanned {
  id: number;
  enabled?: boolean;
  deleted?: boolean;
  categoriesIds?: number[];
  hotkey?: { prefix?: string; suffix?: string };
  data?: Array<{ lang?: string; title?: string; msg?: string; content?: string; isDefault?: boolean }>;
}

/** Resolve a CSDS domain across known aliases, with a region-derived fallback host. */
async function domainFor(accountId: string, services: string[], fallbackHost: string): Promise<string> {
  for (const svc of services) {
    try {
      return await resolveDomain(accountId, svc);
    } catch {
      /* try next */
    }
  }
  const anyDomain = await resolveDomain(accountId, 'agentVep'); // e.g. ause1.agentvep.liveperson.net
  const region = anyDomain.split('.')[0];
  return `${region}.${fallbackHost}`;
}

async function fetchJson<T>(url: string, bearer: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} at ${url}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/** Canned responses grouped into their categories (skill-scoped if skillIds given). */
export async function listCannedResponses(session: AgentSession, skillIds: string[] = []): Promise<CannedCategory[]> {
  const accountId = session.accountId;
  const bearer = await session.connection.getToken();

  const acDomain = await domainFor(accountId, ['accountConfigReadOnly', 'accountConfigReadWrite'], 'ac.liveperson.net');
  const acrDomain = await domainFor(accountId, ['accountConfigReadWrite', 'accountConfigReadOnly'], 'acr.liveperson.net');

  // 1. Categories (id → name/order).
  const catUrl = `https://${acDomain}/api/account/${accountId}/configuration/le-categories/categories?v=2.0&select=$all&return=active`;
  dbg('[pdc] categories GET', catUrl);
  const rawCats = await fetchJson<RawCategory[]>(catUrl, bearer).catch((e) => {
    dbg('[pdc] categories failed:', e instanceof Error ? e.message : e);
    return [] as RawCategory[];
  });
  const catById = new Map<number, RawCategory>();
  for (const c of rawCats) if (!c.deleted) catById.set(c.id, c);

  // 2. Canned responses with FULL data (select=$all → includes msg body + hotkey).
  const skills = skillIds.filter(Boolean).join(',');
  const cannedUrl =
    `https://${acrDomain}/api/account/${accountId}/configuration/engagement-window/canned-responses` +
    `?v=2.0&select=$all&source=ccuiNAWGetPredContent&group_by=CATEGORIES&lang=en-US${skills ? `&skill_ids=${encodeURIComponent(skills)}` : ''}`;
  dbg('[pdc] canned GET', cannedUrl);
  // With group_by=CATEGORIES the response is an OBJECT keyed by categoryId
  // ("-1" = no skill / all), each value an array of canned responses — NOT a flat
  // array. (If the account returns a flat array, handle that too.)
  const rawResp = await fetchJson<Record<string, RawCanned[]> | RawCanned[]>(cannedUrl, bearer);
  dbg('[pdc] response shape:', Array.isArray(rawResp) ? 'array' : `keys=${Object.keys(rawResp).join(',')}`);

  const shape = (r: RawCanned, categoryId: number | null): CannedResponse => {
    const d = r.data?.find((x) => x.isDefault) ?? r.data?.find((x) => x.lang?.startsWith('en')) ?? r.data?.[0];
    return {
      id: r.id,
      title: d?.title ?? `#${r.id}`,
      text: d?.msg ?? d?.content ?? null,
      enabled: r.enabled !== false,
      categoryId,
      categoryName: categoryId != null && categoryId >= 0 ? catById.get(categoryId)?.name ?? null : null,
      hotkey: r.hotkey ?? null,
    };
  };

  // Build groups directly from the response keys (the category grouping).
  const groups = new Map<number, CannedCategory>();
  const addItem = (it: CannedResponse, catKey: number) => {
    if (!groups.has(catKey)) {
      const cat = catKey >= 0 ? catById.get(catKey) : undefined;
      groups.set(catKey, {
        id: catKey,
        name: cat?.name ?? (catKey < 0 ? 'All skills' : `#${catKey}`),
        order: cat?.order ?? (catKey < 0 ? 1000 : 999),
        items: [],
      });
    }
    groups.get(catKey)!.items.push(it);
  };

  if (Array.isArray(rawResp)) {
    for (const r of rawResp) {
      if (r.enabled === false || r.deleted) continue;
      const cid = r.categoriesIds?.[0] ?? -1;
      addItem(shape(r, cid), cid);
    }
  } else {
    for (const [key, arr] of Object.entries(rawResp)) {
      const catKey = Number(key);
      for (const r of arr ?? []) {
        if (r.enabled === false || r.deleted) continue;
        addItem(shape(r, catKey), catKey);
      }
    }
  }
  return [...groups.values()].sort((a, b) => a.order - b.order);
}
