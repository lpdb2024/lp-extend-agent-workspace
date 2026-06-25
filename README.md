# agent-chat-widget — Standalone Agent Workspace POC

A minimal, standalone agent workspace built on the **official LivePerson Messaging
Platform SDK** (`lp-messaging-sdk`). It validates four proof points about brand-side
LP integration — the unifying hypothesis being that **running LP calls server-side
bypasses the CORS / CSP / same-site walls** that blocked browser-only attempts in the
earlier `app-contact-center` prototype.

```
server/   Node + Express + TypeScript — holds the SDK brand connection, exposes /api + SSE
client/   Vue 3 + Vite + Tailwind v4 — dark agent console, talks only to /api (never to LP)
```

The browser never contacts LivePerson directly. It talks to the Express server over
`fetch` + Server-Sent Events; the server holds the `lp-messaging-sdk` brand connection
and makes every LP call. That separation is the whole point.

## Proof points & status

| # | Goal | Mechanism | Status |
|---|------|-----------|--------|
| 1 | **Human-agent brand login (UN+PW & SSO)** | **Password:** agentVep `/login` (SDK does this via `authData:{username,password}`). **SSO:** Sentinel OAuth2 **browser redirect** (`/authorize` → `/callback?code` → `/token`), bearer fed to the SDK via a custom `tokenMaintainer`. Both → `setAgentState(ONLINE)`. | ✅ **Built & verified reaching LP.** Against real acct 31487986: SSO authorize URL builds with the real Extend OAuth client; agentVep login hits LP's login endpoint. Needs valid agent creds to show ONLINE. |
| 2 | **Fileshare agent→customer** | `conversation.uploadFile(buffer, caption)` — one SDK call; handles get-upload-url + PUT + publish `hosted/file`. | ✅ **Built.** Requires `messaging.file.sharing.enabled` site setting. |
| 3 | **Secure Forms (PCI), full flow** | List configured forms → publish `forms/secure-invitation` → detect the consumer's `forms/secure-submission` live → `GenerateDownloadToken` + detokenize the **masked** values via the PCI gateway → mark `VIEWED`. | ✅ **Built & working end-to-end** (password + SSO). Agent picks a real form, consumer submits, agent opens the masked submission. **See [docs/SECURE-FORMS.md](docs/SECURE-FORMS.md)**. |
| 4 | **Cobrowse (fully server-side, off-domain)** | UMS invite dialog (`mode: view`) → server-side CometD session (handshake → agent-channel subscribe → `createSN` → long-poll) → on accept, sign the ticket → **proxy the authenticated room + bridge the screen WebSocket** through our HTTPS origin so it embeds in-app. | ✅ **Built & working end-to-end** (password + SSO). Consumer gets the prompt, accepts, and the live screen renders in the agent panel. **See [docs/COBROWSE.md](docs/COBROWSE.md)** for the full write-up — this one was non-trivial. |

## Run it

One terminal, from the repo root:

```bash
npm run install:all
npm run dev          # client on :9400, server on :8787 (proxied), color-prefixed
```

Open **http://localhost:9400** and sign in with a **brand agent** account — SSO (browser
redirect) or Account ID + agent username/password. Routed conversations stream in live.

> Port 9400 is deliberate: the SSO callback origin becomes `http://localhost:9400/callback`,
> which is the redirect URI registered in the LP OAuth app.

Production-style (server serves the built client on **:9400**):

```bash
npm run build
npm start            # open http://localhost:9400
```

## Embeddable widget (400×700) + Docker

Besides the full-screen console at `/`, the app ships a **compact 400×700 widget** —
LP-customer-widget sized — meant to be **embedded in a CRM via an `<iframe>`**. Both
surfaces share one logic layer (`client/src/composables/useWorkspace.ts`); the widget is
just a compact view (slim rail + header + chat body + a slide-out panel, with
per-conversation actions tucked into dropdowns). It has **full feature parity**:
conversation switching, thread, composer (send / file / AI rewrite+translate / canned
hotkeys), notes, SDEs/customer, predefined content, secure forms, page history, cobrowse +
video + voice, transfer, end / back-to-queue / private message, sign out.

**Where it lives**
- Dev (Vite): **http://localhost:9400/widget.html**
- Prod (Express serves it): **`<origin>/widget`**

**Run as a container** (single image: builds the client, server serves it + `/api`):

```bash
cp server/.env.example server/.env     # fill in LP_SSO_* (or use password login)
npm run docker:build                   # docker build -t agent-chat-widget .
npm run docker:run                     # -p 9400:9400 -p 9443:9443
```

Then visit **`/demo`** — a **sample host page** (a stand-in "Acme CRM") that shows how a
developer embeds the widget with a single origin-relative `<iframe src="/widget">`. It's a
demonstration of the *host page*, not the widget itself. Dev: `http://localhost:9400/demo`;
prod/Docker: `<origin>/demo`.

To embed in your own app, copy the snippet (point `src` at your widget backend's origin):

```html
<iframe
  src="https://YOUR-BACKEND/widget"
  width="400" height="700"
  allow="camera; microphone; clipboard-write"
  style="border:0;border-radius:18px"></iframe>
```

**Embed notes**
- **`allow="camera; microphone"`** is required for the video/voice call features.
- **SSO inside the iframe** uses a **popup** — LP's Sentinel login page sends
  `X-Frame-Options: DENY`, so it can't render inside the embedded `<iframe>`. The popup is a
  top-level window LP *will* render; it lands on a dedicated, widget-styled
  **`<origin>/widget/callback`** page ("Signing you in…"), completes the token exchange, and
  `postMessage`s the session back into the iframed widget, then closes. That
  `…/widget/callback` URL must be registered in the LP OAuth app and listed in
  `LP_SSO_REDIRECT_URIS`. Password login works directly in the frame (no popup).
- **Cross-site embeds** (widget hosted on a different origin than the server) need the
  session cookie as `SameSite=None; Secure` — set `WIDGET_CROSS_SITE_COOKIE=1` (requires
  HTTPS). Same-origin / first-party embeds work as-is.
- **Cobrowse/calls in a container**: the room is self-signed HTTPS on `:9443`. Trust it once
  at `https://<host>:9443/api/health`, or set `COBROWSE_HTTPS_ORIGIN` to a real TLS origin
  behind a reverse proxy. The room can also be **popped out** to a new tab from the panel.

### How it's packaged (one origin, two parts)

The widget **can't** be a pure front-end CDN drop-in — it always needs a backend holding
the `lp-messaging-sdk` connection (that's the whole CORS-bypass point). But there's no
separate CDN artifact to manage: **one backend serves both the widget UI (`/widget`) and
the `/api` routes**, so the embed is just an `<iframe>` pointing at *that backend's* origin.
Same origin ⇒ cookies, the SSO redirect, and the cobrowse room all "just work" — you only
change the **origin** per environment, and the code derives everything from it
(`window.location.origin`), nothing hardcoded.

```
 CRM page  ──<iframe src="BACKEND/widget">──►  your backend (this codebase)
                                                  ├─ serves /widget  (the UI)
                                                  ├─ /api/*           (REST + SSE)
                                                  └─ holds the lp-messaging-sdk conn ──► LivePerson
```

A developer integrating this either runs the **Docker image** as-is, or uses `server/` as
the **reference** and ports the LP routes into their own backend. Either way the front-end
is delivered the same way: an iframe at their backend's `/widget`.

### Three environments (only the origin changes)

| Env | Origin | `server/.env` | LP OAuth redirect URIs to register |
|-----|--------|---------------|-------------------------------------|
| **Local** | `http://localhost:9400` | `COBROWSE_HTTPS_PORT=9443` (self-signed room) | `…/callback`, `…/widget`, `…/widget.html` |
| **Tunnel** (ngrok/cloudflared, for local cobrowse+SSO over real HTTPS) | `https://<tunnel>` | `COBROWSE_HTTPS_ORIGIN=https://<tunnel>` | `https://<tunnel>/callback`, `/widget` |
| **Cloud Run** (hosted example) | `https://<svc>.run.app` | `COBROWSE_HTTPS_ORIGIN=https://<svc>.run.app` (auto-disables local :9443) | `https://<svc>.run.app/callback`, `/widget` |

- Setting **`COBROWSE_HTTPS_ORIGIN`** tells the server TLS is terminated upstream, so it
  serves the cobrowse room from the main origin and skips the local `:9443` server. Cloud
  Run also injects `$PORT` — the image's `start:cloud` binds it (no hardcoded port).
- **SSO needs LP to register your redirect URIs.** Since SSO setup involves LP anyway, add
  each environment's `/callback` + `/widget` URLs at the same time. Password (agentVep)
  login needs none of this.
- **Local tunnel quickstart:** `cloudflared tunnel --url http://localhost:9400` (or
  `ngrok http 9400`), then set `COBROWSE_HTTPS_ORIGIN` to the printed https URL and register
  it. Now cobrowse/calls + SSO behave exactly like prod, no cert prompts.

## Auth configuration (SSO)

SSO uses the LP Sentinel OAuth2 authorization-code flow with the Extend OAuth app.
Set these in `server/.env` (already wired via `dotenv`):

```
LP_SSO_CLIENT_ID=a9ee9e8f-1b09-4150-a75f-64500b698ba7
LP_SSO_CLIENT_SECRET=********
```

The browser is redirected to LP and returns to `<origin>/callback?code&state`. That
**redirect URI must be registered** in the LP OAuth app — here that's
`http://localhost:9400/callback` (registered already). Both dev and prod-style modes serve
the UI on :9400, so the callback is identical in both. Password login (agentVep) needs no
client secret.

## How each goal is exercised in the UI
- **Login** — Login screen; toggle SSO (browser redirect) / Username (agentVep).
- **Fileshare** — File in the conversation header → pick a file (JPEG/PNG/GIF/PDF).
- **Secure form** — Secure form button → pick a configured form → consumer fills it in →
  the submission card appears in the thread → **View submission** shows the masked values.
  Full details: **[docs/SECURE-FORMS.md](docs/SECURE-FORMS.md)**.
- **Cobrowse** — Cobrowse button in the thread → consumer gets the invite prompt → on
  accept, the live screen renders in the right-hand panel (or **Pop out**). All derived from
  the conversation; no manual `serviceId`. Full details: **[docs/COBROWSE.md](docs/COBROWSE.md)**.

## Key files
- `server/src/lp/connection.ts` — SDK brand connection, session registry, SSE event bus,
  raw-notification fallbacks for live messages/conversations (goal 1 + resilience).
- `server/src/routes/auth.ts` — `/api/auth/login` (UN+PW) and `/login/sso` (SAML).
- `server/src/routes/messaging.ts` — SSE feed, send message, `uploadFile` (goal 2).
- `server/src/lp/secure-form.ts` — list / invite / read-token / detokenize (goal 3 — see [docs/SECURE-FORMS.md](docs/SECURE-FORMS.md)).
- `server/src/lp/cobrowse.ts` — CometD session, room auth, HTTP proxy (goal 4 — see [docs/COBROWSE.md](docs/COBROWSE.md)).
- `server/src/lp/cobrowse-invite.ts` — UMS invite / accept / cancel dialogs (goal 4).
- `server/src/lp/cobrowse-ws-proxy.ts` — WebSocket bridge for the cobrowse screen stream (goal 4).
- `server/src/lp/sdk.d.ts` — minimal ambient typings for the untyped `lp-messaging-sdk`.

## Notes / caveats
- `lp-messaging-sdk` is **CommonJS** and ships no `.d.ts`; we import the default export and
  destructure (`import lpm from 'lp-messaging-sdk'`) and provide a local type shim.
- Sessions are **in-memory** (a `Map` keyed by an `sid` cookie). POC-grade; no persistence.
- **Cobrowse runs over an HTTPS origin** (self-signed cert in `server/.cert/`, default `:9443`);
  trust it once in the browser. Everything is derived from the conversation — see the
  [cobrowse doc](docs/COBROWSE.md) for the full flow and gotchas.
