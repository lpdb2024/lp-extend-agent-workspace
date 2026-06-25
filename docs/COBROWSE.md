# Server-side Cobrowse (Agent → Consumer) — how it actually works

This document explains how this sample app drives a **LivePerson cobrowse session
entirely from the server**, so that a brand-built agent workspace (running on its own
domain, e.g. `localhost`) can invite a consumer to cobrowse and embed the live screen —
**without** running inside LiveEngage/CCUI and **without** the agent's browser being
logged into `*.liveperson.net`.

It was, frankly, the hard part of this POC. Cobrowse is not a documented public API —
it's an internal LP subsystem (CometD sync server + the "synchronite" room app) that the
native Agent Workspace talks to from inside an authenticated LP browser session. Getting
it to work from a brand domain meant reverse-engineering the real flow from network
captures and proxying the pieces the browser can't reach.

> **Files**
> - [`server/src/lp/cobrowse.ts`](../server/src/lp/cobrowse.ts) — the CometD session + room proxy + auth
> - [`server/src/lp/cobrowse-invite.ts`](../server/src/lp/cobrowse-invite.ts) — the UMS dialog (invite / accept / cancel)
> - [`server/src/lp/cobrowse-ws-proxy.ts`](../server/src/lp/cobrowse-ws-proxy.ts) — the WebSocket bridge for the screen stream
> - [`server/src/routes/cobrowse.ts`](../server/src/routes/cobrowse.ts) — HTTP routes (start, SSE, room proxy, stop)
> - [`server/src/lp/self-cert.ts`](../server/src/lp/self-cert.ts) — self-signed HTTPS cert
> - [`client/src/views/Workspace.vue`](../client/src/views/Workspace.vue) — the agent-side UI panel

---

## TL;DR — the moving parts

A cobrowse session has **two independent channels** that must both succeed:

1. **The UMS messaging dialog** — what makes the *consumer* see the "Agent wants to
   cobrowse — Accept / Decline" prompt. This is a normal UMS `UpdateConversationField`
   over the agent's existing messaging connection.
2. **The cobrowse CometD session** — the LP "sync server" that creates the service
   number (ticket), receives the consumer's accept, and serves the live room. This runs
   over a *separate* host (`{brandId}.{region}.cobrowse.liveperson.net`) with its own
   cookies and auth.

The agent's view of the consumer's screen is then a **web app ("synchronite")** served
by that cobrowse host, which the browser normally loads directly. Because our app is on a
different origin and has no LP login session, we **proxy that room through our own
server**, which *does* hold the authenticated cobrowse session.

```
            (1) UMS invite                          (2) CometD session
  Agent app ───────────────► UMS ──► Consumer       Agent app ──► /api/cobrowse/:id/cobrowse
     │                          (prompt appears)        │              │
     │                                                  │     server opens CometD long-poll
     │                                                  │     to the cobrowse host, createSN
     │     consumer taps Accept ──────────────────────► │     accept push (startSession+ticket)
     │                                                  │              │
     │                                                  │     sign ticket → authenticated room URL
     ▼                                                  ▼              ▼
  iframe ◄──── /api/cobrowse/:key/room (HTTPS proxy) ◄── server proxies room + bridges screen WS
```

---

## Step by step

### 0. Inputs (auth-method agnostic)

The session is built in [`POST /api/conversations/:id/cobrowse`](../server/src/routes/cobrowse.ts)
from four things, all derived from the SDK connection — **identical for password and SSO login**:

| Input         | Source                                  |
| ------------- | --------------------------------------- |
| `accessToken` | `session.connection.getToken()` (bearer)|
| `agentId`     | `session.connection.agentId` (`accountId.numericId`) |
| `agentName`   | `session.loginName`                     |
| `brandId`     | `session.accountId`                     |

Plus, read from the conversation: `consumerId`, `serviceId` (`consumerId#conversationId`),
`skillId`, and the shark `sessionId` / `visitorId` from `conversation.context`.

Nothing here is password-specific — cobrowse works the same under SSO.

### 1. The consumer invite — UMS dialog (`cobrowse-invite.ts`)

`sendCobrowseInvite()` publishes an `UpdateConversationField` → `DialogChange / CREATE`
over the agent's **existing messaging connection** (`connection.send(...)`):

```jsonc
{
  "field": "DialogChange", "type": "CREATE", "dialogId": "<uuid>",
  "dialog": {
    "dialogType": "OTHER", "channelType": "COBROWSE", "state": "OPEN",
    "metaData": {
      "serviceId": "<consumerId>#<conversationId>",
      "sessionState": "INVITED",
      "mode": "view",                 // ⚠️ see gotcha below
      "notificationKey": "invited",
      "callLink": "https://{brandId}.{region}.cobrowse.liveperson.net/join-call/<serviceId>?skillId=..."
    },
    "participants": ["<consumerId>", "<accountId>.<numericAgentId>"]
  }
}
```

> 🔑 **GOTCHA #1 — `mode` must be a permission level, not `"COBROWSE"`.**
> The consumer web widget (lpUnifiedWindow `CoBrowseManager`) only renders the invite if
> `metaData.mode` is in its `acceptedCoBrowseModes = ['view','shared','follow','VIDEO_CALL','VOICE_CALL']`.
> `"COBROWSE"` is the *channelType*, **not** a mode — sending it means the dialog is created
> (`UMS: "OK Add dialog success"`) but the consumer **never sees a prompt**. For screen-share
> cobrowse use **`view`** (read-only), `shared`, or `follow`. Calls use `VIDEO_CALL`/`VOICE_CALL`.
> The route maps `'cobrowse' → 'view'`.

When the consumer cancels/declines, or the agent ends a pending invite, you **must close
the dialog** (`sendCobrowseCancel()` → `DialogChange / UPDATE` → `state: CLOSE`,
`sessionState: CLOSED`, `notificationKey: cancel_invitation`). Otherwise the `INVITED`
dialog stays open and LP rejects the next invite — you can't re-invite.

### 2. The CometD session (`cobrowse.ts` → `CobrowseSession`)

This is the part that talks to the cobrowse "sync" server. Transport is **HTTP
long-polling** (CometD) against `https://{brandId}.{region}.cobrowse.liveperson.net`.

```
handshake → subscribe AGENT channel → connect(initial) → createSN (HTTP) → long-poll /sync/connect
```

> 🔑 **GOTCHA #2 — sticky cookies.** The sync server is node-sticky: the handshake sets
> `cobrowsenode` and `SYNCHRONITEID` cookies, and **every subsequent request must send them
> back** or routing breaks. We keep a per-session cookie jar (`nodePost` merges every
> `Set-Cookie`). The deployed LP reference says it plainly: *"All requests in a session must
> use the same axios instance to preserve cookies for session affinity."*

> 🔑 **GOTCHA #3 — the accept arrives on the AGENT channel.** When the consumer accepts,
> the push comes on `/a/{brandId}/{base64(brandId:numericId)}` (the agent channel), **not**
> on the ticket channels. So we subscribe the agent channel right after handshake. The push
> looks like:
> ```jsonc
> { "action": "startSession", "t": "<short-ticket>", "type": "cobrowse", ... }
> ```
> **The event discriminator is `action`, not `type`** — `type` here is the *mode*
> (`"cobrowse"`), so checking `type` matches nothing. Read `action`.

> 🔑 **GOTCHA #4 — ticket-room join/subscribe 403s, and that's fine.** The "production WS
> proxy" reference does `/service/ticket` join + `/t/sn` + `/pl` subscribes + heartbeat —
> all of which return `403 denied_by_security_policy` on a normal brand bearer. They are
> **best-effort and irrelevant**: the accept is delivered on the agent channel regardless.
> We keep them (wrapped in try/catch) only to match the reference shape.

### 3. Signing the room URL (`getSignedCallUrl`)

The `t` ticket from the accept push is **not** the room URL — it's exchanged at
`POST /login/access_token` (form: `access_token=<bearer>`, `ticket`, `url=/proxyless?ticket=…&profile=p-<mode>`).
The response `signedUrl` is an OAuth1-signed `/oauth?redirect=/proxyless…` URL — the real
agent room. Profile is `p-` + the mode (cobrowse → `p-view`).

### 4. Serving the room — the proxy (`cobrowse.ts` + `routes/cobrowse.ts`)

This is the crux of running cobrowse off-domain.

> 🔑 **GOTCHA #5 — the room authenticates against a *browser* LP session we don't have.**
> Opening the signed `/oauth` URL directly in our iframe/popup returns **401** — `/oauth`
> validates the agent's LiveEngage browser session (`loginState-*`, `LPSID-*` cookies),
> which our `localhost` browser never has (we auth server-side via bearer/SSO). agentVep
> login does **not** hand us those cookies, so there's no way to give them to the browser.
>
> **Solution: proxy the room through our server.** Our server *can* authenticate — its
> cobrowse cookie jar passes `/oauth → /login/callback → /successfullogin` cleanly (the
> OAuth1 signature is valid), capturing the room session cookie. `authenticateRoom()` follows
> that redirect chain and resolves the final `/proxyless` URL. Then:
> - `GET /api/cobrowse/:key/room` fetches the room HTML with the authenticated jar.
> - `ALL /api/cobrowse/:key/asset/*` proxies every asset / XHR / CometD request (any method,
>   raw body) with the same jar.
>
> The browser only ever talks to **our** origin; the server holds the auth.

To make the room run on our origin, the proxied HTML/JS is **rewritten**
([`rewriteHtml` / `rewriteUrls`](../server/src/routes/cobrowse.ts)):
- Absolute cobrowse-host URLs → `/api/cobrowse/:key/asset`
- **Root-relative** `src`/`href` (`/js/…`, `/css/…`) and bare-relative (`proxylessFrame?…`,
  `../images/…`) → the proxy prefix. *(A `<base>` tag isn't enough — root-relative paths
  ignore `<base>`, and the iframe `src` resolved against the wrong path. We rewrite every
  `src`/`href` explicitly.)*
- The bare `tenantHost` hostname inside synchronite's config → our HTTPS origin, so its
  runtime-built URLs (incl. the WebSocket) come back to us.
- `document.domain = …` is neutralised with a no-op shim injected at the top of `<head>`
  (it throws `"undefined.localhost is not a suffix of localhost"` and would halt the page).

### 5. The live screen — WebSocket bridge (`cobrowse-ws-proxy.ts`)

The synchronite room opens a **WebSocket** for the live screen stream. After the
`tenantHost` rewrite it dials `wss://<our-https-origin>/api/cobrowse/:key/asset/sync`.

> 🔑 **GOTCHA #6 — synchronite forces secure scheme (`https`/`wss`).** It builds its sync
> URLs as `https://…` / `wss://…` regardless of the page protocol. A plain-HTTP dev server
> gives `ERR_SSL_PROTOCOL_ERROR`. **So the room must be served over real TLS** — we run an
> **HTTPS listener** (`self-cert.ts`, default `:9443`) and point the room iframe there. The
> self-signed cert is persisted to `server/.cert/` and must be trusted once in the browser
> (visit `https://localhost:9443/api/health` → Proceed).

The server's `upgrade` handler routes WS upgrades on `/api/cobrowse/:key/asset/*` to
`handleCobrowseUpgrade()`, which opens an upstream `wss` to the **real** cobrowse host with
the session's authenticated cookies and pipes frames both ways. In dev, Vite's proxy needs
`ws: true` to forward the upgrade.

### 6. The agent UI (`Workspace.vue`)

- Click **Cobrowse** → `POST /conversations/:id/cobrowse` → opens an SSE stream
  (`/api/cobrowse/:key/events`) for `connected` / `inviteSent` / `consumerJoining` /
  `canStartCall` / `error`.
- On `canStartCall` the server emits the room URL as `https://localhost:9443/api/cobrowse/:key/room`,
  which the panel loads in an **iframe** (same-origin to its own assets/WS, served by our
  proxy). A **Pop out** button opens it in a tab.
- **End** → `POST /cobrowse/:key/stop` → cancels the pending UMS invite and tears down the
  CometD session.

---

## Auth on the proxy routes

`/room` and `/asset/*` are loaded by the iframe from the **HTTPS origin (`:9443`)**, a
*different* origin than the app (`:9400`), so they **cannot carry the app session cookie**.
They are authorized instead by the **unguessable session `:key`** in the URL → the
server-side authenticated jar. The router applies `requireSession` to the start/events/stop
routes but **not** to the two proxy routes. (See the middleware at the top of
[`routes/cobrowse.ts`](../server/src/routes/cobrowse.ts).)

---

## Sequence of network calls (happy path)

```
Agent app          Our server                         UMS                 Cobrowse host
   │  POST /cobrowse  │                                  │                       │
   │ ───────────────► │  handshake ──────────────────────────────────────────►  │  (cookies set)
   │                  │  subscribe /a/{brandId}/{b64} ───────────────────────►   │
   │                  │  connect(initial) ───────────────────────────────────►  │
   │                  │  createSN (HTTP) ────────────────────────────────────►  │  → serviceId
   │  SSE: connected  │                                                          │
   │ ◄─────────────── │  sendCobrowseInvite ──────────►  │ (INVITED dialog)      │
   │  SSE: inviteSent │                                  │ ──► consumer prompt   │
   │                  │  long-poll /sync/connect ────────────────────────────►  │  (waiting…)
   │                  │                                  │  consumer ACCEPTS     │
   │                  │  ◄── push {action:startSession, t} on agent channel ───  │
   │                  │  POST /login/access_token (sign t) ──────────────────►  │  → signedUrl
   │                  │  GET signedUrl → follow /oauth→/login/callback ──────►   │  (room cookie)
   │  SSE: canStartCall (room URL = https://:9443/api/cobrowse/:key/room)        │
   │  iframe GET /room│  proxy room HTML (rewritten) ────────────────────────►  │
   │  iframe assets   │  proxy /asset/* (js/css/xhr/cometd) ─────────────────►   │
   │  iframe WS       │  bridge wss ─────────────────────────────────────────►  │  (live screen)
```

---

## Video & voice calls (the `/call` room)

Calls reuse the same invite/accept/sign/proxy machinery as cobrowse, but the **room is
different** and has three extra requirements that each surface as the same opaque
`"The call you are trying to join has ended."` message. All three were found by dumping
the room HTML — the room's inline config script fails silently.

| Aspect | Cobrowse | Calls |
| --- | --- | --- |
| UMS `mode` | `view` | `VIDEO_CALL` / `VOICE_CALL` |
| Room path | `/proxyless?profile=p-view` | `/call?profile=video-call\|voice-call` |
| createSN `p` | `view` | `video-call` / `voice-call` |

**Call-only requirement 1 — `username` must be the agent fullName.**
The `/login/access_token` form field `username` must be the agent's **`fullName`** (e.g.
`BrandtS`), not the email/loginName. Resolve it from the AC le-users API **by numeric id**:
`GET {ac}/api/account/{id}/configuration/le-users/users/{userId}?v=4.0` → use
`fullName || nickname || loginName`. (The `/users/pid/{pid}` variant needs the UUID pid and
**400s** on a numeric id.) An empty/wrong username → the call room rejects the agent →
"ended". See `fetchDisplayName` in `lp-auth.ts`, threaded as `AgentIdentity.displayName`.

**Call-only requirement 2 — `skillId` must be in the `/call` URL.** ⚠️ the real trap.
The room renders `config.skillId` **from the URL's `skillId` query param**. If it's empty,
the generated HTML is literally:

```js
var config = { ticket:"…", username:"BrandtS", isAgent:true, type:"video", skillId: };
//                                                                          ^^^^^^^^ empty → SyntaxError
```

That trailing `skillId:` with no value is a **JavaScript syntax error** — the inline script
throws, `window.callConfig` never gets set, and `run.js` shows the "ended" warning **without
making any network call**. Putting skillId only in createSN is *not* enough; it must be
`&skillId=…` on the `/call` path (`roomPath()` in `cobrowse.ts`).

**Call-only requirement 3 — start the session exactly once.** A double start POST (panel
re-render / SSE reconnect) runs `createSN` twice; the two sessions race and tear the call
down. Guarded synchronously with an in-flight `Set` keyed by conversation id, plus a
deterministic-key idempotency check (`cobrowse.ts` route).

> Debugging tip: if a call shows "ended" but signing returns 200 and the consumer's camera
> starts, **dump the full room HTML** and inspect `var config = {…}` for empty fields.

---

## Limitations / notes for adopters

- **TLS + cert trust is required.** The embedded room only works over HTTPS (gotcha #6).
  The self-signed cert must be trusted once per browser (persisted in `server/.cert/`). For
  a real deployment, serve the app over a proper TLS cert and a single HTTPS origin.
- **`view` (read-only) is the wired default.** `shared` (agent can interact) and `follow`
  (agent leads navigation) are one-word changes to the mode mapping.
- **Ticket-room 403s are expected** (gotcha #4) and logged as warnings — ignore them.
- **This is reverse-engineered, not a public API.** The CometD shapes, `tenantHost`
  rewriting, and `document.domain` shim depend on current synchronite/cobrowse behavior and
  could change. Treat it as a working reference, not a contract.
- **Region** defaults to `ause1`; set `region` per your account's CSDS region.
- **Diagnostic logging** (`[cobrowse] …`, `[cobrowse-ws] …`) is left in on purpose so
  adopters can see the flow; quiet it down for production.

---

## Quick troubleshooting

| Symptom                                            | Cause / fix |
| -------------------------------------------------- | ----------- |
| Consumer never sees the invite prompt              | `mode` is `"COBROWSE"` — use `view` (gotcha #1) |
| Invite worked once, second invite rejected         | Pending dialog not closed — `sendCobrowseCancel` (gotcha #1) |
| Agent stuck "waiting", consumer already sharing     | Not subscribed to agent channel, or reading `type` instead of `action` (gotchas #3) |
| `403 denied_by_security_policy` on join/subscribe   | Expected — ignore (gotcha #4) |
| Room iframe → 401 Unauthorized                      | Opening the raw cobrowse URL instead of the server proxy (gotcha #5) |
| Room iframe blank, console `ERR_SSL_PROTOCOL_ERROR` | Room not served over TLS — use the HTTPS origin (gotcha #6) |
| Room iframe "temporarily down"                      | Self-signed cert not trusted — visit `https://localhost:9443/api/health` and Proceed |
| `Cannot read properties of undefined (getConversation)` | Start route bypassed `requireSession` (session not attached) — middleware scoping |
| Video/voice: "The call you are trying to join has ended" | One of the 3 call-only requirements — usually empty `skillId:` in the `/call` URL (malformed room config JS). Also check `username`=fullName and single-start. Dump the room HTML to confirm |
