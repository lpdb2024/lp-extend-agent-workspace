# Secure Forms (PCI) — agent-side flow

This document explains how the sample app sends a **PCI-compliant secure form** to a
consumer, detects their submission live, and lets the agent open the **masked** values —
all server-side, reverse-engineered from CCUI captures (`development/secureforms.md`,
`development/secureform.ws.md`).

The point of secure forms: the consumer types sensitive data (card number, CVV…) into a
form the **agent never sees in the clear**. The values are tokenized in LP's PCI vault;
the agent can only retrieve a **masked** view via one-time tokens.

> **Files**
> - [`server/src/lp/secure-form.ts`](../server/src/lp/secure-form.ts) — list / invite / read-token / detokenize / mark-viewed
> - [`server/src/routes/secure-form.ts`](../server/src/routes/secure-form.ts) — HTTP routes
> - [`server/src/lp/connection.ts`](../server/src/lp/connection.ts) — surfaces `forms/secure-*` messages + the live-event fallback
> - [`client/src/views/Workspace.vue`](../client/src/views/Workspace.vue) — form picker, message cards, submission viewer

---

## The flow

```
Agent app           Our server                         UMS / PCI
   │ GET /secure-forms │                                  │
   │ ─────────────────►│  GET secureformconfig (by skill) │  → [{id,name,fields}]
   │ ◄─────────────────│                                  │
   │  (picks a form)   │                                  │
   │ POST /secure-form │  PublishEvent forms/secure-      │
   │ ─────────────────►│  invitation (formId, invitationId)│ ──► consumer fills it in
   │                   │                                  │
   │                   │   consumer SUBMITS               │
   │                   │ ◄── forms/secure-submission ─────│  (live, via raw notification)
   │  (submission card appears in thread)                 │
   │ POST /…/view      │  GenerateDownloadToken → readOtk │
   │ ─────────────────►│  detokenize (PCI gateway) ───────│  → masked values
   │ ◄─── masked data ─│  AcceptStatusEvent VIEWED (audit)│
```

### 1. List configured forms

`listForms()` → `GET https://{region}.secureformconfig.liveperson.net/secureformconfig/v1/{accountId}/form?skills={skillIds}&source=ccui`
(Bearer auth). Returns the forms configured for the conversation's skill, each with its
field schema (`{id, name, type, required, masked, transientField}`).

### 2. Send the invitation

`sendInvite()` publishes a `ContentEvent` with **`contentType: forms/secure-invitation`**
over the agent's messaging connection:

```jsonc
{ "type": ".ams.ms.PublishEvent", "body": {
  "dialogId", "conversationId",
  "event": { "type": "ContentEvent", "contentType": "forms/secure-invitation",
    "message": { "formId": 1550964770, "invitationId": "<id>", "title": "Credit Card Form" } }
}}
```

> 🔑 **invitationId shape** — `{consumerId}-{formId}-{epochMs}-{n}`. It's the correlation
> key for the whole exchange, and the `formId` can be recovered from it later (the
> submission event doesn't always carry the formId).

### 3. Consumer submits (live)

The submission arrives as a `ContentEvent` with **`contentType: forms/secure-submission`**,
`message: { submissionId, invitationId }`.

> 🔑 **GOTCHA — the SDK silently drops this live.** On history-loaded conversations the SDK
> emits `no conversation to send for MCCA` and never fires its `message` event, so the
> submission only appeared after a page refresh. **Fix:** a raw-notification fallback in
> [connection.ts](../server/src/lp/connection.ts) (`handleOnlineEvent`) parses the live
> `.ams.ms.OnlineEventDistribution` frame directly and emits the message itself, deduped
> against the SDK path by `(conversationId, sequence)`. This same fallback also recovers
> live **conversation** changes (`handleConversationChange`).

`viewMessage` tags `forms/secure-*` content events with a `secureForm` field
(`kind`, `formId`, `title`, `invitationId`, `submissionId`) so the UI renders a card
instead of raw text.

### 4. Agent opens the submission → detokenize

Two steps:

**a) Read token** — `GenerateDownloadToken`:
```jsonc
{ "type": ".ams.ms.token.GenerateDownloadToken", "body": {
  "downloadable": { "type": "SecureForm", "dialogId", "submissionId", "invitationId" } }}
→ { "token": { "type": "SecureFormReadToken", "readOtk": "<uuid>" } }
```

**b) Detokenize** — the masked values come from the **PCI gateway**:
```
GET https://{region}.tokenizer.liveperson.net/pcigw/api/detokenize
    ?siteid={accountId}
    &otk={readOtk}                      ← from GenerateDownloadToken
    &token={vaultToken}                 ← the submission's stored-data ref (= submissionId)
    &otkJson={accountId}:{invitationId}
    &formid={formId}
```

> 🔑 **GOTCHA — three separate tokens, easy to confuse.**
> - `otk` = the **readOtk** from `GenerateDownloadToken` (authorizes the read).
> - `token` = the **PCI vault token** — a *different* value, **NOT** in the
>   `GenerateDownloadToken` response. In this flow it's the **`submissionId`** (the
>   reference to the consumer's stored data). Missing/wrong → `errorCode 70`.
> - `otkJson` = `{accountId}:{invitationId}`.
>
> The detokenize call carries **no Authorization header** — it's authorized purely by the
> one-time tokens in the query string.

> 🔑 **GOTCHA — the response is double-encoded.** `response.results` is **HTML-entity-encoded
> JSON**, e.g. `&#123;&quot;values&quot;:&#91;…`. Decode the entities, then `JSON.parse`,
> then flatten `values:[{name,value}]` → `{ "Credit Card number": "1232131", … }`.
> (`parseDetokenizeResults` / `decodeHtmlEntities` handle this.)

**c) Mark viewed** — `markViewed()` publishes `AcceptStatusEvent status: VIEWED` so the
audit trail records that the agent opened the submission. Best-effort (doesn't block the view).

---

## HTTP routes

| Route | Purpose |
| ----- | ------- |
| `GET  /api/conversations/:id/secure-forms` | List forms for the conversation's skill |
| `POST /api/conversations/:id/secure-form` | Send an invitation (`{ formId, formName }`) |
| `POST /api/conversations/:id/secure-form/view` | Read token + detokenize (`{ submissionId, invitationId, formId, sequence }`) |

---

## CSDS service names

- **List forms** → `secureFormConfig` (aliases tried: `secureformconfig`, `pciCaptureService`;
  region fallback `{region}.secureformconfig.liveperson.net`).
- **Detokenize** → `{region}.tokenizer.liveperson.net` (region derived from any resolved
  CSDS domain, e.g. the `agentVep` host's leading label).

---

## Auth note

Everything is auth-method agnostic — `accessToken` is `connection.getToken()` (works for
both password/agentVep and SSO). The only PCI-specific auth is the one-time `otk`/vault
`token` in the detokenize query string.

---

## Troubleshooting

| Symptom | Cause / fix |
| ------- | ----------- |
| No forms listed | None configured for that skill, or wrong CSDS service name |
| Consumer never sees the form | Wrong `contentType` (must be `forms/secure-invitation`) or account lacks the `SECURE_FORMS` feature |
| Submission only shows after refresh | SDK dropped the live event (MCCA) — needs the raw-notification fallback (gotcha in step 3) |
| Detokenize → `errorCode 70` | Missing/incorrect `token` (vault) param — it's the `submissionId`, not the readOtk |
| Detokenize 200 but garbled data | `results` is HTML-entity-encoded JSON — decode before parsing |
| `data` empty, only token shown | The read endpoint rejected the call; the viewer falls back to showing the token + raw probe result |
