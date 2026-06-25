import { Router, type Request, type Response } from 'express';
import { requireSession } from './auth.js';
import type { AgentSession } from '../lp/connection.js';
import { invokeLlm } from '../lp/llm.js';
import { fetchPrompts } from '../lp/prompts.js';

export const llmRouter = Router();
llmRouter.use(requireSession);

type Req = Request & { session: AgentSession };

llmRouter.get('/prompts', async (req: Request, res: Response) => {
  try {
    const prompts = await fetchPrompts((req as Req).session);
    res.json({ prompts });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

llmRouter.post('/llm/invoke', async (req: Request, res: Response) => {
  const prompt = (req.body?.prompt ?? '').toString().trim();
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });
  try {
    const result = await invokeLlm((req as Req).session, prompt);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

llmRouter.post('/llm/translate', async (req: Request, res: Response) => {
  const session = (req as Req).session;
  const texts: string[] = Array.isArray(req.body?.texts) ? req.body.texts : [];
  const targetLang: string = (req.body?.targetLang ?? session.accountLang ?? 'en-US').toString();
  if (!texts.length) return res.status(400).json({ error: 'texts[] is required' });

  const joined = texts.map((t, i) => `[${i}] ${t}`).join('\n');
  const prompt = `Translate each numbered item below to ${targetLang}. Return ONLY the translations, one per line, each prefixed with its number in the same [N] format. Do not add any explanation.\n\n${joined}`;

  try {
    const { text } = await invokeLlm(session, prompt);
    // Parse [N] prefixed lines back into an array indexed by N
    const result: string[] = texts.map((t) => t); // default: original
    for (const line of text.split('\n')) {
      const m = line.match(/^\[(\d+)\]\s*([\s\S]+)/);
      if (m) {
        const idx = parseInt(m[1], 10);
        if (idx >= 0 && idx < texts.length) result[idx] = m[2].trim();
      }
    }
    res.json({ translations: result });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
