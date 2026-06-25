import { Router, type Request, type Response } from 'express';
import type { AgentSession } from '../lp/connection.js';
import { requireSession } from './auth.js';
import { listForms, sendInvite, getSubmission, markViewed } from '../lp/secure-form.js';

export const secureFormRouter = Router();
secureFormRouter.use(requireSession);

type Req = Request & { session: AgentSession };

/** List secure forms configured for a conversation's skill (Goal 3). */
secureFormRouter.get('/conversations/:id/secure-forms', async (req: Request, res: Response) => {
  const session = (req as Req).session;
  try {
    const { skillId } = session.conversationMeta(req.params.id);
    // Pass the conversation's skill; fall back to all known skills if none.
    const skills = skillId ? [skillId] : session.allSkillIds();
    const forms = await listForms(session.connection, skills);
    res.json({ forms });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** Send a secure-form invitation to the consumer. */
secureFormRouter.post('/conversations/:id/secure-form', async (req: Request, res: Response) => {
  const session = (req as Req).session;
  const { formId, formName } = (req.body ?? {}) as { formId?: number; formName?: string };
  if (formId == null) return res.status(400).json({ error: 'formId is required' });
  try {
    const dialogId = session.mainDialogId(req.params.id);
    const { consumerId } = session.conversationMeta(req.params.id);
    if (!consumerId) return res.status(409).json({ error: 'no consumer id on conversation' });
    const result = await sendInvite(session.connection, {
      conversationId: req.params.id,
      dialogId,
      consumerId,
      formId,
      formName: formName ?? 'Secure form',
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** Open a submitted form: generate a read token, fetch the masked data, mark VIEWED. */
secureFormRouter.post('/conversations/:id/secure-form/view', async (req: Request, res: Response) => {
  const session = (req as Req).session;
  const { submissionId, invitationId, formId, sequence } = (req.body ?? {}) as {
    submissionId?: string;
    invitationId?: string;
    formId?: string;
    sequence?: number;
  };
  if (!submissionId || !invitationId) {
    return res.status(400).json({ error: 'submissionId and invitationId are required' });
  }
  try {
    const dialogId = session.mainDialogId(req.params.id);
    const result = await getSubmission(session.connection, {
      conversationId: req.params.id,
      dialogId,
      submissionId,
      invitationId,
      formId,
    });
    // Best-effort audit trail — don't fail the view if VIEWED publish errors.
    if (typeof sequence === 'number') {
      markViewed(session.connection, { conversationId: req.params.id, dialogId, sequence }).catch(() => {});
    }
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
