import { resolveDomain } from './csds.js';

/**
 * Real LivePerson agent authentication — ported from the Extend app
 * (apps/api/src/auth/auth.controller.ts and marketplace CCIDP service).
 *
 * Two paths, both ending in a bearer + agent identity that we feed to the SDK:
 *  - Password : agentVep /login (logs the agent into CCUI; no refresh).
 *  - SSO      : Sentinel OAuth2 authorization-code browser redirect.
 *
 * All of this runs server-side, so there is no CORS — the same reason the old
 * browser-only prototype couldn't do it.
 */

export interface AgentIdentity {
  bearer: string;
  userPid: string;
  userId: string;
  agentId: string;
  loginName: string;
  displayName?: string;
  email?: string;
  imageUrl?: string;
  expiresAt: number;
  skillIds?: number[];
  agentGroupId?: number;
  agentGroupName?: string;
}

/** Fetch the agent's nickname/fullName from the AC le-users API by NUMERIC id.
 * (The /users/pid/{pid} variant needs the UUID pid; /users/{id} takes the numeric
 * userId we reliably have.) The user object carries nickname + fullName + names. */
interface LeUser {
  nickname?: string;
  fullName?: string;
  loginName?: string;
  pictureUrl?: string;
  userImageURL?: string;
  email?: string;
  skillIds?: number[];
  agentGroupId?: number;
  agentGroupName?: string;
}

async function fetchLeUser(accountId: string, bearer: string, userId: string): Promise<LeUser | undefined> {
  if (!userId) return undefined;
  try {
    const baseURI = await resolveDomain(accountId, 'accountConfigReadOnly');
    const url = `https://${baseURI}/api/account/${encodeURIComponent(accountId)}/configuration/le-users/users/${encodeURIComponent(userId)}?v=4.0`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' } });
    if (!res.ok) return undefined;
    return (await res.json()) as LeUser;
  } catch {
    return undefined;
  }
}

async function fetchDisplayName(accountId: string, bearer: string, userId: string): Promise<string | undefined> {
  const u = await fetchLeUser(accountId, bearer, userId);
  return u ? (u.fullName || u.nickname || u.loginName || undefined) : undefined;
}

// Read lazily so dotenv has loaded by call time (avoids import-order fragility).
const ssoClientId = () => process.env.LP_SSO_CLIENT_ID ?? 'a9ee9e8f-1b09-4150-a75f-64500b698ba7';
const ssoClientSecret = () => process.env.LP_SSO_CLIENT_SECRET ?? '';

/** Password login against agentVep. Returns bearer + agent identity. */
export async function agentVepLogin(
  accountId: string,
  username: string,
  password: string,
): Promise<AgentIdentity> {
  const baseURI = await resolveDomain(accountId, 'agentVep');
  const url = `https://${baseURI}/api/account/${encodeURIComponent(accountId)}/login?v=1.3`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`agentVep login failed: HTTP ${res.status} ${text.slice(0, 400)}`);
  }
  const data = (await res.json()) as {
    bearer?: string;
    accessToken?: string;
    config?: { userId?: string; userPid?: string; loginName?: string; expiresIn?: number };
    expiresIn?: number;
  };
  const bearer = data.bearer ?? data.accessToken;
  if (!bearer) throw new Error('agentVep login: no bearer returned');
  const userId = data.config?.userId ?? '';
  const userPid = data.config?.userPid ?? userId;
  const loginName = data.config?.loginName ?? username;
  const expiresInSec = data.config?.expiresIn ?? data.expiresIn ?? 3600;
  const leUser = await fetchLeUser(accountId, bearer, userId);
  return {
    bearer,
    userPid,
    userId,
    agentId: `${accountId}.${userId}`,
    loginName,
    displayName: leUser?.fullName || leUser?.nickname || leUser?.loginName,
    email: leUser?.email,
    imageUrl: leUser?.pictureUrl || leUser?.userImageURL,
    expiresAt: Date.now() + expiresInSec * 1000,
    skillIds: leUser?.skillIds,
    agentGroupId: leUser?.agentGroupId,
    agentGroupName: leUser?.agentGroupName,
  };
}

/** Build the Sentinel OAuth2 authorize URL the browser is redirected to. */
export async function ssoAuthorizeUrl(accountId: string, redirectUri: string): Promise<string> {
  const domain = await resolveDomain(accountId, 'sentinel');
  const params = new URLSearchParams({
    v: '1.0',
    response_type: 'code',
    redirect_uri: redirectUri,
    client_id: ssoClientId(),
    state: accountId,
  });
  return `https://${domain}/sentinel/api/account/${encodeURIComponent(accountId)}/authorize?${params.toString()}`;
}

/** Minimal base64url JWT payload decode (no signature check — we only read claims). */
function decodeJwt(token: string): Record<string, unknown> {
  const part = token.split('.')[1] ?? '';
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  const json = Buffer.from(b64, 'base64').toString('utf8');
  return JSON.parse(json) as Record<string, unknown>;
}

/** Exchange the SSO authorization code for a bearer + agent identity. */
export async function ssoExchangeCode(
  accountId: string,
  code: string,
  redirectUri: string,
): Promise<AgentIdentity & { refreshToken?: string }> {
  const clientSecret = ssoClientSecret();
  if (!clientSecret) {
    throw new Error('LP_SSO_CLIENT_SECRET is not set — required for SSO token exchange');
  }
  const domain = await resolveDomain(accountId, 'sentinel');
  const url = `https://${domain}/sentinel/api/account/${encodeURIComponent(accountId)}/token?v=2.0`;
  const body = new URLSearchParams({
    client_id: ssoClientId(),
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Sentinel token exchange failed: HTTP ${res.status} ${text.slice(0, 400)}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    id_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  const claims = decodeJwt(data.id_token);
  const userPid = (claims.sub as string) ?? '';
  const loginName = (claims.email as string) ?? (claims.sub as string) ?? 'sso-user';
  // Sentinel tokens encode the short numeric agent id in the bearer's `lp_sub`/`agentId`
  // claim on some accounts; fall back to resolving via agentVep below if absent.
  const shortFromClaim = (claims.agentId as string) ?? (claims.lpAgentId as string) ?? '';
  const expiresInSec = data.expires_in ?? 4 * 3600;

  let userId = shortFromClaim;
  if (!userId) {
    userId = await resolveShortUserId(accountId, data.access_token, userPid);
  }
  const leUser = await fetchLeUser(accountId, data.access_token, userId);

  return {
    bearer: data.access_token,
    refreshToken: data.refresh_token,
    userPid,
    userId,
    agentId: `${accountId}.${userId}`,
    loginName,
    displayName: leUser?.fullName || leUser?.nickname || leUser?.loginName,
    email: leUser?.email,
    imageUrl: leUser?.pictureUrl || leUser?.userImageURL,
    expiresAt: Date.now() + expiresInSec * 1000,
    skillIds: leUser?.skillIds,
    agentGroupId: leUser?.agentGroupId,
    agentGroupName: leUser?.agentGroupName,
  };
}

/**
 * Resolve the short numeric agent id from the UUID userPid via the AC Users API.
 * The SDK needs `agentId = accountId.shortId` for routing/state calls.
 */
async function resolveShortUserId(accountId: string, bearer: string, userPid: string): Promise<string> {
  try {
    const baseURI = await resolveDomain(accountId, 'accountConfigReadWrite');
    const url = `https://${baseURI}/api/account/${encodeURIComponent(accountId)}/configuration/le-users/users/pid/${encodeURIComponent(userPid)}?v=4.0`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' } });
    if (res.ok) {
      const u = (await res.json()) as { id?: string | number };
      if (u.id != null) return String(u.id);
    }
  } catch {
    /* fall through */
  }
  // Last resort: use the UUID; many UMS calls accept the pid-qualified id.
  return userPid;
}
