/**
 * Single-shot LLM call via AI Studio inline passthrough flow.
 * No dependency on a saved flow — the full flow definition is sent
 * inline in the request, matching the working "execute prompt" shape.
 *
 * Endpoint: POST https://{aiStudioDomain}/api/v2/flows/response
 * Auth:     CC-Bearer {lp_bearer}
 */

import type { AgentSession } from './connection.js';

const domainCache = new Map<string, string>();

async function aiStudioDomain(accountId: string): Promise<string> {
  const cached = domainCache.get(accountId);
  if (cached) return cached;
  const url = `https://api.liveperson.net/api/account/${encodeURIComponent(accountId)}/service/aiStudioPlatformService/baseURI.json?version=1.0`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CSDS aiStudioPlatformService lookup failed (${res.status})`);
  const json = (await res.json()) as { baseURI?: string };
  if (!json.baseURI) throw new Error('CSDS returned no baseURI for aiStudioPlatformService');
  domainCache.set(accountId, json.baseURI);
  return json.baseURI;
}

function inlinePassthroughFlow(): unknown {
  return {
    display_name: 'inline passthrough',
    description: null,
    use_case: null,
    template: false,
    public: false,
    nodes: [
      {
        id: 'LPLLMGateway-passthrough',
        type: 'LPLLMGateway',
        base_type: 'llm',
        position: { x: 1600, y: -140 },
        disabled: false,
        data: {
          subscription_name: { show: true, value: 'lp-ptu-gpt-4o' },
          openai_model_name: { show: true, value: 'gpt-3.5-turbo' },
          cohere_model_name: { show: true, value: 'command' },
          google_model_name: { show: true, value: 'gemini-2.5-flash' },
          amazon_model_name: { show: true, value: 'amazon.nova-lite-v1:0' },
          anthropic_model_name: { show: true, value: 'claude-3-5-sonnet-latest' },
          api_version: { show: false, value: '2024-02-15-preview' },
          llm_provider: { show: true, value: 'openai-azure' },
          top_p: { show: false, value: '0.9' },
          max_tokens: { show: false, value: '2000' },
          temperature: { show: false, value: '0.8' },
          llm_mode: { show: true, value: 'chat' },
          openai_azure_model_name: { show: true, value: 'gpt-4o-2024-11-20' },
        },
      },
      {
        id: 'LPContextualMemory-passthrough',
        type: 'LPContextualMemory',
        base_type: 'memory',
        position: { x: 2400, y: 140 },
        disabled: false,
        data: {
          dynamic_vars_key_map: { show: true, value: { current_time: { test_value: '', dynamic_var_name: 'current_datetime' } } },
          llm: { show: false, value: null },
          static_vars_key_map: { show: true, value: {} },
          max_turns: { show: false, value: -1 },
          conversational_slot_key_map: { show: true, value: {} },
          conversational_slot_key_list: { show: false, value: '' },
          context_vars_key_map: {
            show: true,
            value: {
              prompt: { test_value: '', secure_context_var: 'botContext.prompt' },
            },
          },
        },
      },
      {
        id: 'LLMChain-passthrough',
        type: 'LLMChain',
        base_type: 'chain',
        position: { x: 2800, y: -260 },
        disabled: false,
        data: {
          json_mode: { show: true, value: false },
          llm: { show: true, value: null },
          memory: { show: true, value: null },
          prompt: { show: true, value: null },
          name: { show: true, value: 'CONTEXT' },
          save_output: { show: true, value: true },
          output_key: { show: false, value: 'output' },
        },
      },
      {
        id: 'LPPrompt-passthrough',
        type: 'LPPrompt',
        base_type: 'prompt',
        position: { x: 2060, y: -530 },
        disabled: false,
        data: {
          user_msg_role: { show: false, value: 'Consumer' },
          include_user_msg: { show: false, value: true },
          template: { show: true, value: '{prompt}' },
          template_role: { show: false, value: 'System' },
          input_variables: { show: false, value: 'prompt' },
          prompt_library_id: { show: true, value: null },
          include_chat_history: { show: false, value: true },
          prompt_library_version: { show: true, value: '' },
          prompt_input_choice: { show: true, value: 'Raw Prompt' },
          memory_key: { show: false, value: 'chat_history' },
        },
      },
    ],
    edges: [
      { id: 'Edge-llm', source: 'LPLLMGateway-passthrough', target: 'LLMChain-passthrough', sourceHandle: 'output', targetHandle: 'llm', disabled: false },
      { id: 'Edge-prompt', source: 'LPPrompt-passthrough', target: 'LLMChain-passthrough', sourceHandle: 'output', targetHandle: 'prompt', disabled: false },
      { id: 'Edge-memory', source: 'LPContextualMemory-passthrough', target: 'LLMChain-passthrough', sourceHandle: 'output', targetHandle: 'memory', disabled: false },
    ],
  };
}

export interface LlmResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  generationTimeSeconds: number;
}

export async function invokeLlm(session: AgentSession, prompt: string): Promise<LlmResult> {
  const { accountId } = session;
  const bearer = await session.connection.getToken();
  const domain = await aiStudioDomain(accountId);

  const url = `https://${domain}/api/v2/flows/response`;
  const body = {
    text: '.',
    source: 'AI_DOJO',
    bot_context_vars: { prompt: prompt.trim() },
    flow: inlinePassthroughFlow(),
  };

  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `CC-Bearer ${bearer}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`AI Studio invoke failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const raw = (await res.json()) as Array<{
    text?: string;
    generation_time?: number;
    usage_metrics?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  }>;

  const arr = Array.isArray(raw) ? raw : [];
  const text = arr.map((m) => m.text ?? '').filter(Boolean).join('\n');
  const last = arr[arr.length - 1];
  const usage = last?.usage_metrics ?? {};

  return {
    text,
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    totalTokens: usage.total_tokens ?? 0,
    generationTimeSeconds: last?.generation_time ?? (Date.now() - t0) / 1000,
  };
}
