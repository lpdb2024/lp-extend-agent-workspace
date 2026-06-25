/**
 * CSDS domain resolution. LP service domains are account-specific and resolved
 * from api.liveperson.net. This runs server-side, so no CORS — unlike the browser.
 */
const cache = new Map<string, { domains: Record<string, string>; at: number }>();
const TTL_MS = 5 * 60 * 1000;

export async function resolveDomains(accountId: string): Promise<Record<string, string>> {
  const hit = cache.get(accountId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.domains;

  const url = `https://api.liveperson.net/api/account/${accountId}/service/baseURI.json?version=1.0`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CSDS lookup failed (${res.status}) for account ${accountId}`);
  const json = (await res.json()) as { baseURIs: Array<{ service: string; baseURI: string }> };
  const domains: Record<string, string> = {};
  for (const e of json.baseURIs) domains[e.service] = e.baseURI;
  cache.set(accountId, { domains, at: Date.now() });
  return domains;
}

export async function resolveDomain(accountId: string, service: string): Promise<string> {
  const domains = await resolveDomains(accountId);
  const d = domains[service];
  if (!d) throw new Error(`CSDS: service '${service}' not found for account ${accountId}`);
  return d;
}
