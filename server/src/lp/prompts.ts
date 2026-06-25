import type { AgentSession } from './connection.js';

const PROMPT_LIBRARY_DOMAIN = 'ause1.promptlibrary.liveperson.net';

export interface LpPrompt {
  id: string;
  name: string;
  clientType: string;
  description: string;
  promptHeader: string;
  status: string;
  langCode: string;
}

export async function fetchPrompts(session: AgentSession): Promise<LpPrompt[]> {
  const { accountId } = session;
  const bearer = await session.connection.getToken();
  const url = `https://${PROMPT_LIBRARY_DOMAIN}/v2/accounts/${encodeURIComponent(accountId)}/prompts`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${bearer}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Prompt library fetch failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { success?: boolean; successResult?: { prompts?: LpPrompt[] } };
  return json?.successResult?.prompts ?? [];
}
