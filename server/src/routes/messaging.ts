import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import type { AgentSession } from '../lp/connection.js';
import { requireSession } from './auth.js';
import { dbg } from '../lp/debug.js';
import { listCannedResponses } from '../lp/predefined-content.js';
import { getConvDetail, getConsumerHistory, getHistoryMessages } from '../lp/msg-interactions.js';

export const messagingRouter = Router();
messagingRouter.use(requireSession);

// LP messaging file-sharing supports images (JPEG/PNG/GIF) and PDF only.
const ALLOWED_FILE_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'application/pdf']);
const ALLOWED_FILE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'pdf']);
const MAX_FILE_BYTES = 25 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = (file.originalname.split('.').pop() ?? '').toLowerCase();
    if (ALLOWED_FILE_MIME.has(file.mimetype) || ALLOWED_FILE_EXT.has(ext)) return cb(null, true);
    cb(new Error(`Unsupported file type. LP allows: ${[...ALLOWED_FILE_EXT].join(', ')}`));
  },
});

type Req = Request & { session: AgentSession };

/** List currently-known conversations. */
messagingRouter.get('/conversations', (req: Request, res: Response) => {
  res.json({ conversations: (req as Req).session.listConversations() });
});

// ── Panel: agent notes ───────────────────────────────────────────────────────
messagingRouter.get('/conversations/:id/notes', (req: Request, res: Response) => {
  try {
    res.json({ notes: (req as Req).session.getNotes(req.params.id) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

messagingRouter.post('/conversations/:id/notes', async (req: Request, res: Response) => {
  const note = (req.body?.note ?? '').toString();
  try {
    await (req as Req).session.setAgentNote(req.params.id, note);
    res.json({ ok: true, notes: (req as Req).session.getNotes(req.params.id) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Panel: SDEs (customer info) ──────────────────────────────────────────────
messagingRouter.get('/conversations/:id/sdes', (req: Request, res: Response) => {
  try {
    res.json((req as Req).session.getSdes(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Panel: customer info + SDEs + page history (single MI API call) ──────────
messagingRouter.get('/conversations/:id/customer', async (req: Request, res: Response) => {
  try {
    const detail = await getConvDetail((req as Req).session, req.params.id);
    res.json(detail ?? { info: null, pages: [], sdes: [] });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

messagingRouter.get('/conversations/:id/pages', async (req: Request, res: Response) => {
  try {
    const detail = await getConvDetail((req as Req).session, req.params.id);
    res.json({ pages: detail?.pages ?? [] });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Panel: predefined content (canned responses, grouped by category) ─────────
messagingRouter.get('/predefined-content', async (req: Request, res: Response) => {
  try {
    const skills = (req.query.skills ?? '').toString().split(',').filter(Boolean);
    const categories = await listCannedResponses((req as Req).session, skills);
    res.json({ categories });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** Skills (id → name) — transfer targets for the conversation context menu. */
messagingRouter.get('/skills', (req: Request, res: Response) => {
  res.json({ skills: (req as Req).session.listSkills() });
});

/** Agents + managers — transfer targets (Agent/Manager tabs in transfer dialog). */
messagingRouter.get('/agents', async (req: Request, res: Response) => {
  try {
    const session = (req as Req).session;
    const agents = await session.listAgents();
    res.json({ agents });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** End (close) a conversation. */
messagingRouter.post('/conversations/:id/close', async (req: Request, res: Response) => {
  try {
    await (req as Req).session.closeConversation(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** Return a conversation to its skill queue (un-assign the current agent). */
messagingRouter.post('/conversations/:id/back-to-queue', async (req: Request, res: Response) => {
  try {
    await (req as Req).session.backToQueue(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** Transfer a conversation to another skill (or agent). */
messagingRouter.post('/conversations/:id/transfer', async (req: Request, res: Response) => {
  const { skillId, agentId } = (req.body ?? {}) as { skillId?: string; agentId?: string };
  if (!skillId && !agentId) return res.status(400).json({ error: 'skillId or agentId is required' });
  try {
    await (req as Req).session.transferConversation(req.params.id, { skillId, agentId });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** Send an agent-only private message (not visible to the consumer). */
messagingRouter.post('/conversations/:id/private', async (req: Request, res: Response) => {
  const text = (req.body?.text ?? '').toString();
  if (!text.trim()) return res.status(400).json({ error: 'text is required' });
  try {
    const result = await (req as Req).session.sendPrivate(req.params.id, text);
    res.json({ ok: true, sequence: result?.sequence ?? null });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** Previous conversations for the consumer of conversation :id. */
messagingRouter.get('/conversations/:id/history', async (req: Request, res: Response) => {
  const session = (req as Req).session;
  const conv = session.listConversations().find(c => c.conversationId === req.params.id);
  const consumerId = conv?.consumerId;
  if (!consumerId) return res.status(404).json({ error: 'consumerId not available for this conversation' });
  try {
    const history = await getConsumerHistory(session, consumerId, req.params.id);
    res.json({ history });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** Messages for a historical (past) conversation. */
messagingRouter.get('/conversations/:id/history/:histId/messages', async (req: Request, res: Response) => {
  try {
    const messages = await getHistoryMessages((req as Req).session, req.params.histId);
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** Full message history for a conversation (fetched on click). */
messagingRouter.get('/conversations/:id/messages', async (req: Request, res: Response) => {
  try {
    const messages = await (req as Req).session.getMessages(req.params.id);
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

const FILE_MIME: Record<string, string> = {
  PNG: 'image/png',
  JPG: 'image/jpeg',
  JPEG: 'image/jpeg',
  GIF: 'image/gif',
  PDF: 'application/pdf',
};

/** Download a hosted file by its storage relativePath. Streams the raw bytes. */
messagingRouter.get('/files', async (req: Request, res: Response) => {
  const relativePath = (req.query.path ?? '').toString();
  if (!relativePath) return res.status(400).json({ error: 'path query param is required' });
  const fileType = (req.query.type ?? '').toString().toUpperCase();
  try {
    const { data, filename } = await (req as Req).session.downloadFile(relativePath);
    dbg(`[files] ${relativePath} type=${fileType} → ${data.byteLength} bytes`);
    res.set('Content-Type', FILE_MIME[fileType] ?? 'application/octet-stream');
    res.set('Cache-Control', 'private, max-age=3600');
    if (filename) res.set('Content-Disposition', `inline; filename="${filename.replace(/"/g, '')}"`);
    res.send(data);
  } catch (err) {
    console.error(`[files] ${relativePath} failed:`, err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * SSE stream of live events for this agent session: status, new conversations,
 * and incoming/outgoing messages. The browser never touches LP directly.
 */
messagingRouter.get('/events', (req: Request, res: Response) => {
  const session = (req as Req).session;
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  send('ready', { connected: session.connected, conversations: session.listConversations() });

  const onMessage = (m: unknown) => send('message', m);
  const onConversation = (c: unknown) => send('conversation', c);
  const onAssigned = (c: unknown) => send('assigned', c);
  const onStatus = (s: unknown) => send('status', s);
  const onError = (e: unknown) => send('lp-error', { error: e });

  session.on('message', onMessage);
  session.on('conversation', onConversation);
  session.on('assigned', onAssigned);
  session.on('status', onStatus);
  session.on('error', onError);

  const keepAlive = setInterval(() => res.write(': ping\n\n'), 25_000);

  req.on('close', () => {
    clearInterval(keepAlive);
    session.off('message', onMessage);
    session.off('conversation', onConversation);
    session.off('assigned', onAssigned);
    session.off('status', onStatus);
    session.off('error', onError);
  });
});

/** Send a plain-text message to a conversation. */
messagingRouter.post('/conversations/:id/messages', async (req: Request, res: Response) => {
  const session = (req as Req).session;
  const text = (req.body?.text ?? '').toString();
  if (!text.trim()) return res.status(400).json({ error: 'text is required' });
  try {
    const result = await session.sendText(req.params.id, text);
    res.json({ ok: true, sequence: result?.sequence ?? null });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * Goal 2 — Fileshare agent -> customer.
 * One SDK call: conversation.uploadFile(buffer, caption). The SDK handles
 * get-upload-url + PUT to storage + publish hosted/file. Server-side, no CORS.
 * Requires the `messaging.file.sharing.enabled` site setting on the account.
 */
/** Run multer for one file, turning filter/limit rejections into a 400 JSON error. */
const acceptFile = (req: Request, res: Response, next: () => void) =>
  upload.single('file')(req, res, (err: unknown) => {
    if (err) return res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    next();
  });

messagingRouter.post(
  '/conversations/:id/file',
  acceptFile,
  async (req: Request, res: Response) => {
    const session = (req as Req).session;
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) return res.status(400).json({ error: 'file is required (multipart field "file")' });
    const caption = (req.body?.caption ?? file.originalname ?? '').toString();
    try {
      const result = await session.uploadFile(req.params.id, file.buffer, caption);
      res.json({ ok: true, result: result ?? null, fileName: file.originalname });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
        hint: 'Ensure the account has messaging.file.sharing.enabled.',
      });
    }
  },
);
