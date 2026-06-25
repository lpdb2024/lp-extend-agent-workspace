import { randomUUID } from 'node:crypto';
import type { Connection, WsApiRequest } from 'lp-messaging-sdk';
import { resolveDomain } from './csds.js';
import { dbg } from './debug.js';

/**
 * Goal 3 — Secure Forms (PCI), server-side.
 *
 * The full agent-side flow, reverse-engineered from CCUI captures
 * (development/secureforms.md, development/secureform.ws.md):
 *
 *  1. listForms()  — REST GET to secureformconfig: the forms configured for the
 *                    conversation's skill(s).
 *  2. sendInvite() — PublishEvent `forms/secure-invitation` over the agent's
 *                    messaging connection. Consumer sees the form to fill in.
 *  3. (consumer submits) — arrives as a `forms/secure-submission` ContentEvent
 *                    (surfaced to the UI via the message feed). Carries submissionId.
 *  4. getReadToken() — `.ams.ms.token.GenerateDownloadToken` for the submission →
 *                    a one-time `readOtk` the agent uses to view the (masked) data.
 *  5. markViewed() — AcceptStatusEvent VIEWED, so the audit trail shows the agent
 *                    opened it.
 *
 * Everything runs server-side (no CORS), using the SDK connection + bearer.
 */

const PUBLISH_EVENT = '.ams.ms.PublishEvent';
const GENERATE_DOWNLOAD_TOKEN = '.ams.ms.token.GenerateDownloadToken';

// ── Types ────────────────────────────────────────────────────────────────────

export interface SecureFormField {
  id: string;
  name: string;
  type: string; // numeric | text | cvv | ...
  required: boolean;
  masked: boolean;
  transientField: boolean;
}

export interface SecureForm {
  id: number;
  name: string;
  deleted: boolean;
  json: SecureFormField[];
  skills?: number[];
}

export interface SendInviteParams {
  conversationId: string;
  dialogId: string;
  consumerId: string;
  formId: number;
  formName: string;
}

export interface ReadTokenParams {
  conversationId: string;
  dialogId: string;
  submissionId: string;
  invitationId: string;
  formId?: string;
}

// ── 1. List configured forms ─────────────────────────────────────────────────

/**
 * The forms configured for the given skills. Endpoint (from capture):
 *   GET https://{secureFormConfig}/secureformconfig/v1/{accountId}/form?skills=..&source=ccui
 */
export async function listForms(
  connection: Connection,
  skillIds: string[],
): Promise<SecureForm[]> {
  const accountId = connection.accountId;
  const token = await connection.getToken();
  const domain = await resolveSecureFormConfigDomain(accountId);
  const skills = skillIds.filter(Boolean).join(',');
  const url = `https://${domain}/secureformconfig/v1/${accountId}/form?source=ccui${skills ? `&skills=${encodeURIComponent(skills)}` : ''}`;

  dbg('[secure-form] listForms GET', url);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`listForms HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const forms = (await res.json()) as SecureForm[];
  return forms.filter((f) => !f.deleted);
}

/** CSDS service name for the secure-form config service (try known aliases). */
async function resolveSecureFormConfigDomain(accountId: string): Promise<string> {
  for (const svc of ['secureFormConfig', 'secureformconfig', 'pciCaptureService']) {
    try {
      return await resolveDomain(accountId, svc);
    } catch {
      /* try next */
    }
  }
  // Region-derived fallback matching the capture's host pattern.
  const anyDomain = await resolveDomain(accountId, 'agentVep'); // e.g. ause1.agentvep.liveperson.net
  const region = anyDomain.split('.')[0];
  return `${region}.secureformconfig.liveperson.net`;
}

// ── 2. Send the invitation ───────────────────────────────────────────────────

/** A unique invitation id in LP's shape: `<consumerId>-<formId>-<epochMs>-<n>`. */
function buildInvitationId(consumerId: string, formId: number): string {
  return `${consumerId}-${formId}-${Date.now()}-1`;
}

/**
 * Publish the secure-form invitation. ContentType `forms/secure-invitation`, with a
 * message carrying formId / invitationId / title. Returns the invitationId so the UI
 * can correlate the later submission.
 */
export async function sendInvite(
  connection: Connection,
  p: SendInviteParams,
): Promise<{ invitationId: string; sequence: number | null }> {
  const invitationId = buildInvitationId(p.consumerId, p.formId);
  const request: WsApiRequest = {
    type: PUBLISH_EVENT,
    body: {
      dialogId: p.dialogId,
      conversationId: p.conversationId,
      event: {
        type: 'ContentEvent',
        contentType: 'forms/secure-invitation',
        message: { formId: p.formId, invitationId, title: p.formName },
      },
    },
  };
  dbg('[secure-form] sendInvite', JSON.stringify(request.body));
  const resp = (await connection.send(request)) as { sequence?: number } | undefined;
  return { invitationId, sequence: resp?.sequence ?? null };
}

// ── 4. Read the submission (agent opens the form) ────────────────────────────

/**
 * Generate a one-time read token for a submitted form, then resolve the masked
 * submission data. The `GenerateDownloadToken` shape + `SecureFormReadToken.readOtk`
 * are from the capture; the data-fetch endpoint is probed (and reported verbatim)
 * since it isn't in the capture.
 */
export async function getSubmission(
  connection: Connection,
  p: ReadTokenParams,
): Promise<{
  readOtk: string;
  tokenResponse?: unknown; // full GenerateDownloadToken response (to locate the vault token)
  data?: unknown;
  fetch?: { attempted: boolean; status?: number; endpoint?: string; body?: string; error?: string };
}> {
  const tokenReq: WsApiRequest = {
    type: GENERATE_DOWNLOAD_TOKEN,
    body: {
      downloadable: {
        type: 'SecureForm',
        dialogId: p.dialogId,
        submissionId: p.submissionId,
        invitationId: p.invitationId,
      },
    },
  };
  dbg('[secure-form] GenerateDownloadToken', JSON.stringify(tokenReq.body));
  const resp = (await connection.send(tokenReq)) as
    | { token?: { readOtk?: string; token?: string; vaultToken?: string; [k: string]: unknown } }
    | undefined;
  dbg('[secure-form] GenerateDownloadToken resp:', JSON.stringify(resp));
  const tok = resp?.token ?? {};
  const readOtk = tok.readOtk;
  if (!readOtk) throw new Error(`no readOtk in GenerateDownloadToken response: ${JSON.stringify(resp)}`);
  // The PCI vault `token` param is separate from readOtk and is NOT in the
  // GenerateDownloadToken response — in LP's flow it's the submission's stored-data
  // reference, i.e. the submissionId. Allow an explicit override but default to it.
  const vaultToken = (tok.token ?? tok.vaultToken ?? tok.pciToken) as string | undefined ?? p.submissionId;

  // Detokenize against the PCI gateway (captured endpoint):
  //   GET https://{region}.tokenizer.liveperson.net/pcigw/api/detokenize
  //       ?siteid={accountId}&otk={readOtk}&token={vaultToken}
  //       &otkJson={accountId}:{invitationId}&formid={formId}
  // Response.results is HTML-entity-encoded JSON: { values: [{ name, value }] }.
  const out: Awaited<ReturnType<typeof getSubmission>> = { readOtk, tokenResponse: resp };
  try {
    const accountId = connection.accountId;
    const region = await resolveRegion(accountId);
    const params = new URLSearchParams({
      siteid: accountId,
      otk: readOtk,
      otkJson: `${accountId}:${p.invitationId}`,
      formid: p.formId ?? '',
    });
    if (vaultToken) params.set('token', vaultToken);
    const endpoint = `https://${region}.tokenizer.liveperson.net/pcigw/api/detokenize?${params.toString()}`;
    out.fetch = { attempted: true, endpoint };
    // The capture's detokenize call carries no Authorization header — it's authorized
    // by the one-time tokens in the query string.
    const res = await fetch(endpoint, { headers: { Accept: '*/*' } });
    out.fetch.status = res.status;
    const body = await res.text();
    out.fetch.body = body.slice(0, 4000);
    if (res.ok) {
      out.data = parseDetokenizeResults(body);
    }
  } catch (err) {
    out.fetch = { ...(out.fetch ?? { attempted: true }), error: err instanceof Error ? err.message : String(err) };
  }
  return out;
}

/** Region prefix (e.g. "ause1") from a resolved CSDS domain. */
async function resolveRegion(accountId: string): Promise<string> {
  const domain = await resolveDomain(accountId, 'agentVep'); // e.g. ause1.agentvep.liveperson.net
  return domain.split('.')[0];
}

/**
 * The detokenize `results` field is HTML-entity-encoded JSON, e.g.
 *   &#123;&quot;values&quot;:&#91;&#123;&quot;name&quot;:&quot;Credit Card number&quot;,…
 * Decode the entities, parse, and flatten `values:[{name,value}]` → { name: value }.
 */
function parseDetokenizeResults(body: string): unknown {
  let parsed: { results?: string } & Record<string, unknown>;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }
  if (typeof parsed.results !== 'string') return parsed;
  const decoded = decodeHtmlEntities(parsed.results);
  try {
    const obj = JSON.parse(decoded) as { values?: Array<{ name: string; value: string }> };
    if (Array.isArray(obj.values)) {
      const flat: Record<string, string> = {};
      for (const v of obj.values) flat[v.name] = v.value;
      return flat;
    }
    return obj;
  } catch {
    return decoded;
  }
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

// ── 5. Mark viewed (audit trail) ─────────────────────────────────────────────

export async function markViewed(
  connection: Connection,
  p: { conversationId: string; dialogId: string; sequence: number },
): Promise<void> {
  const request: WsApiRequest = {
    type: PUBLISH_EVENT,
    body: {
      dialogId: p.dialogId,
      conversationId: p.conversationId,
      event: { type: 'AcceptStatusEvent', status: 'VIEWED', sequenceList: [p.sequence] },
    },
  };
  await connection.send(request);
}
