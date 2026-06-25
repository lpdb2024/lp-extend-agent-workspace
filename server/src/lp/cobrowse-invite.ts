import { randomUUID } from 'node:crypto';
import type { Connection, WsApiRequest } from 'lp-messaging-sdk';
import { dbg } from './debug.js';

/**
 * Send the consumer-facing cobrowse/call INVITATION via the SDK's arbitrary-UMS
 * escape hatch (connection.send). This is what makes the consumer's web SDK show
 * the "agent wants to cobrowse" prompt — without it the CometD session sits idle
 * and `canStartCall` never fires.
 *
 * Shape ported from the reference workspace SDK (initiateCall): an
 * UpdateConversationField that CREATEs an OPEN COBROWSE dialog with
 * sessionState=INVITED. Returns the dialogId so accept/join can target it.
 */

const UPDATE_CONVERSATION_FIELD = '.ams.cm.UpdateConversationField';

export interface CobrowseInviteParams {
  conversationId: string;
  consumerId: string;
  agentUserId: string; // accountId.shortId
  brandId: string;
  serviceId: string; // `${consumerId}#${conversationId}`
  mode: string; // COBROWSE | VIDEO_CALL | VOICE_CALL
  skillId?: string;
  region?: string;
}

export async function sendCobrowseInvite(
  connection: Connection,
  p: CobrowseInviteParams,
): Promise<{ dialogId: string; callLink: string }> {
  const dialogId = randomUUID();
  const now = Date.now();
  const expires = (now + 120_000) / 1000; // 2 min, seconds-with-fraction (LP format)
  const region = p.region ?? 'ause1';
  const cobrowseDomain = `${p.brandId}.${region}.cobrowse.liveperson.net`;
  const callLink = `https://${cobrowseDomain}/join-call/${encodeURIComponent(p.serviceId)}${
    p.skillId ? `?skillId=${p.skillId}` : ''
  }`;

  const dialogField = {
    field: 'DialogChange',
    type: 'CREATE',
    dialogId,
    dialog: {
      creationTs: now,
      dialogId,
      dialogType: 'OTHER',
      channelType: 'COBROWSE',
      state: 'OPEN',
      metaData: {
        serviceId: p.serviceId,
        expires,
        sessionState: 'INVITED',
        dialogId,
        mode: p.mode,
        notificationKey: 'invited',
        callLink,
      },
      participants: [p.consumerId, p.agentUserId],
      metaDataLastUpdateTs: now,
    },
  };

  // The SDK's dialog-change builder wraps the field in an ARRAY
  // (`conversationField: [data]`). Match that — some UMS versions only propagate
  // the DialogChange (and thus prompt the consumer) when it's array-wrapped.
  const request: WsApiRequest = {
    type: UPDATE_CONVERSATION_FIELD,
    body: {
      conversationId: p.conversationId,
      conversationField: [dialogField],
    },
  };

  dbg('[cobrowse-invite] sending INVITED dialog', JSON.stringify(request.body));
  const resp = await connection.send(request);
  dbg('[cobrowse-invite] UMS response:', JSON.stringify(resp));
  return { dialogId, callLink };
}

/**
 * Send the ACCEPTED / JOINED dialog state updates after the consumer accepts
 * (CometD startSession push). Ported from the reference SDK's acceptCall/joinCall.
 * `notificationKey`: 'accepted' then 'joined'.
 */
export async function sendCobrowseAcceptJoin(
  connection: Connection,
  opts: { conversationId: string; dialogId: string; mode: string },
): Promise<void> {
  const update = (notificationKey: 'accepted' | 'joined'): WsApiRequest => ({
    type: UPDATE_CONVERSATION_FIELD,
    body: {
      conversationId: opts.conversationId,
      conversationField: {
        field: 'DialogChange',
        type: 'UPDATE',
        dialogId: opts.dialogId,
        dialog: {
          dialogId: opts.dialogId,
          dialogType: 'OTHER',
          channelType: 'COBROWSE',
          state: 'OPEN',
          metaData: {
            sessionState: 'ACCEPTED',
            dialogId: opts.dialogId,
            mode: opts.mode,
            notificationKey,
          },
        },
      },
    },
  });

  await connection.send(update('accepted'));
  await connection.send(update('joined'));
}

/**
 * Cancel a pending cobrowse INVITED dialog (agent cancels before the consumer
 * accepts). Without this the INVITED dialog stays OPEN and LP rejects a second
 * invite on the same conversation — so re-inviting is impossible until it's closed.
 *
 * Captured from CCUI: DialogChange UPDATE → state CLOSE, sessionState CLOSED,
 * notificationKey 'cancel_invitation'.
 */
export async function sendCobrowseCancel(
  connection: Connection,
  opts: { conversationId: string; dialogId: string; mode: string },
): Promise<void> {
  const request: WsApiRequest = {
    type: UPDATE_CONVERSATION_FIELD,
    body: {
      conversationId: opts.conversationId,
      conversationField: {
        field: 'DialogChange',
        type: 'UPDATE',
        dialogId: opts.dialogId,
        dialog: {
          dialogId: opts.dialogId,
          dialogType: 'OTHER',
          channelType: 'COBROWSE',
          state: 'CLOSE',
          metaData: {
            sessionState: 'CLOSED',
            dialogId: opts.dialogId,
            mode: opts.mode,
            notificationKey: 'cancel_invitation',
          },
        },
      },
    },
  };
  dbg('[cobrowse-invite] cancelling INVITED dialog', opts.dialogId);
  const resp = await connection.send(request);
  dbg('[cobrowse-invite] cancel response:', JSON.stringify(resp));
}
