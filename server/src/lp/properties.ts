import { resolveDomain } from './csds.js';

const cache = new Map<string, { lang: string; at: number }>();
const TTL_MS = 10 * 60 * 1000;

/** Fetch the account's configured UI language from the AC properties API.
 *  Returns an IETF tag like 'en-US', 'pt-BR', etc. Falls back to 'en-US'. */
export async function fetchAccountLanguage(accountId: string, bearer: string): Promise<string> {
  const hit = cache.get(accountId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.lang;

  try {
    const domain = await resolveDomain(accountId, 'accountConfigReadOnly');
    const url = `https://${domain}/api/account/${encodeURIComponent(accountId)}/configuration/setting/properties?v=3.0`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' } });
    if (res.ok) {
      const props = (await res.json()) as Array<{ id?: string; propertyValue?: { value?: unknown } }>;
      const langProp = props.find(p => p.id === 'le.general.language');
      const lang = String(langProp?.propertyValue?.value ?? 'en-US');
      cache.set(accountId, { lang, at: Date.now() });
      return lang;
    }
  } catch { /* fall through */ }

  cache.set(accountId, { lang: 'en-US', at: Date.now() });
  return 'en-US';
}
