import { Router, type Request, type Response } from 'express';
import { AgentSession, addSession, getSession, removeSession, type AgentAuth } from '../lp/connection.js';
import { agentVepLogin, ssoAuthorizeUrl, ssoExchangeCode } from '../lp/lp-auth.js';
import { loadStatusReasons } from '../lp/status-reasons.js';

export const authRouter = Router();

const COOKIE = 'sid';
// Cross-site CRM embeds (the widget in an <iframe> on another origin) require
// SameSite=None; Secure so the session cookie is sent with framed requests. Enable
// via WIDGET_CROSS_SITE_COOKIE=1 (needs HTTPS). Default stays 'lax' for same-origin.
const crossSite = process.env.WIDGET_CROSS_SITE_COOKIE === '1';
const cookieOpts = crossSite
  ? { httpOnly: true, sameSite: 'none' as const, secure: true, path: '/' }
  : { httpOnly: true, sameSite: 'lax' as const, path: '/' };

/**
 * Goal 1a — Password login (agentVep). The SDK does the agentVep login itself
 * from username/password; we validate the same call up front so the error is clean.
 */
authRouter.post('/login', async (req: Request, res: Response) => {
  const accountId = String(req.body?.accountId ?? '').trim();
  const username = String(req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');
  if (!accountId || !username || !password) {
    return res.status(400).json({ error: 'accountId, username and password are required' });
  }
  try {
    // Validate credentials against agentVep first (clean 401 on bad creds) and
    // capture the agent identity so the session can scope its subscription to me.
    const identity = await agentVepLogin(accountId, username, password);
    await startSession(res, accountId, { kind: 'password', username, password, identity }, identity.loginName);
  } catch (err) {
    res.status(401).json({ error: 'LP login failed', detail: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * Goal 1b — SSO step 1: return the Sentinel OAuth2 authorize URL. The browser
 * navigates there; LP redirects back to `redirect` with ?code&state.
 */
authRouter.get('/login/sso/url', async (req: Request, res: Response) => {
  const accountId = String(req.query.accountId ?? '').trim();
  const redirect = String(req.query.redirect ?? '').trim();
  if (!accountId || !redirect) {
    return res.status(400).json({ error: 'accountId and redirect are required' });
  }
  try {
    const url = await ssoAuthorizeUrl(accountId, redirect);
    res.json({ url });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * Goal 1b — SSO step 2: exchange the authorization code for a bearer, then open
 * the brand connection with that bearer (custom token maintainer). `state` = accountId.
 */
authRouter.post('/login/sso/callback', async (req: Request, res: Response) => {
  const code = String(req.body?.code ?? '').trim();
  const accountId = String(req.body?.state ?? req.body?.accountId ?? '').trim();
  const redirect = String(req.body?.redirect ?? '').trim();
  if (!code || !accountId || !redirect) {
    return res.status(400).json({ error: 'code, state (accountId) and redirect are required' });
  }
  try {
    const identity = await ssoExchangeCode(accountId, code, redirect);
    await startSession(res, accountId, { kind: 'sso', identity }, identity.loginName);
  } catch (err) {
    res.status(401).json({ error: 'SSO sign-in failed', detail: err instanceof Error ? err.message : String(err) });
  }
});

async function startSession(res: Response, accountId: string, auth: AgentAuth, loginName: string) {
  const session = new AgentSession(accountId, auth, loginName);
  try {
    await session.start();
  } catch (err) {
    await session.stop();
    return res.status(502).json({
      error: 'LP brand connection failed',
      detail: err instanceof Error ? err.message : String(err),
    });
  }
  addSession(session);
  res.cookie(COOKIE, session.id, cookieOpts);
  res.json({
    sessionId: session.id,
    accountId: session.accountId,
    loginName: session.loginName,
    displayName: session.displayName,
    email: session.email,
    imageUrl: session.imageUrl,
    connected: session.connected,
    conversations: session.listConversations(),
  });
}

authRouter.get('/me', (req: Request, res: Response) => {
  const session = getSession(req.cookies?.[COOKIE]);
  if (!session) return res.status(401).json({ error: 'not signed in' });
  res.json({
    sessionId: session.id,
    accountId: session.accountId,
    loginName: session.loginName,
    displayName: session.displayName,
    email: session.email,
    imageUrl: session.imageUrl,
    connected: session.connected,
    lastError: session.lastError,
    agentState: session.agentState,
    skillIds: session.skillIds,
    agentGroupName: session.agentGroupName,
    accountLang: session.accountLang,
    conversations: session.listConversations(),
  });
});

authRouter.post('/state', async (req: Request, res: Response) => {
  const session = getSession(req.cookies?.[COOKIE]);
  if (!session) return res.status(401).json({ error: 'not signed in' });
  const state = String(req.body?.state ?? '').toUpperCase();
  if (!['ONLINE', 'AWAY', 'BACK_SOON', 'OFFLINE'].includes(state)) {
    return res.status(400).json({ error: 'state must be ONLINE | AWAY | BACK_SOON | OFFLINE' });
  }
  try {
    await session.changeAgentState(state as 'ONLINE' | 'AWAY' | 'BACK_SOON' | 'OFFLINE');
    res.json({ ok: true, agentState: session.agentState });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

authRouter.post('/return-to-queue', async (req: Request, res: Response) => {
  const session = getSession(req.cookies?.[COOKIE]);
  if (!session) return res.status(401).json({ error: 'not signed in' });
  try {
    await session.returnToQueue();
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

authRouter.get('/status-reasons', async (req: Request, res: Response) => {
  const session = getSession(req.cookies?.[COOKIE]);
  if (!session) return res.status(401).json({ error: 'not signed in' });
  try {
    const reasons = await loadStatusReasons(session.accountId, session.bearer);
    res.json(reasons);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

authRouter.post('/logout', async (req: Request, res: Response) => {
  const id = req.cookies?.[COOKIE];
  if (id) await removeSession(id);
  res.clearCookie(COOKIE, cookieOpts);
  res.json({ ok: true });
});

/** Express middleware: attaches req.session or 401s. */
export function requireSession(req: Request, res: Response, next: () => void) {
  const session = getSession(req.cookies?.[COOKIE]);
  if (!session) return res.status(401).json({ error: 'not signed in' });
  (req as Request & { session: AgentSession }).session = session;
  next();
}
