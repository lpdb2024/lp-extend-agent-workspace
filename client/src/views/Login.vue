<script setup lang="ts">
import { ref } from "vue";
import { api, type Me } from "../lib/api";

const props = defineProps<{ initialError?: string | null }>();
const emit = defineEmits<{ (e: "signed-in", me: Me): void }>();

const mode = ref<"sso" | "password">("sso");
const accountId = ref(localStorage.getItem("acw-account") ?? "");
const username = ref("");
const password = ref("");
const busy = ref(false);
const error = ref<string | null>(props.initialError ?? null);

const savedAccounts = ref<string[]>(
  (() => {
    try {
      return JSON.parse(localStorage.getItem("acw-saved") ?? "[]");
    } catch {
      return [];
    }
  })(),
);

function rememberAccount(id: string) {
  const set = new Set([id, ...savedAccounts.value]);
  savedAccounts.value = [...set].slice(0, 5);
  localStorage.setItem("acw-saved", JSON.stringify(savedAccounts.value));
}

function callbackUri() {
  return `${window.location.origin}/callback`;
}

async function submit() {
  if (!accountId.value.trim()) return;
  busy.value = true;
  error.value = null;
  try {
    localStorage.setItem("acw-account", accountId.value.trim());
    rememberAccount(accountId.value.trim());
    if (mode.value === "password") {
      const me = await api.loginPassword(
        accountId.value.trim(),
        username.value.trim(),
        password.value,
      );
      emit("signed-in", me);
    } else {
      const { url } = await api.ssoUrl(accountId.value.trim(), callbackUri());
      window.location.href = url;
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    busy.value = false;
  }
}
</script>

<template>
  <div class="login">
    <!-- ── Left: form column ─────────────────────────────────── -->
    <div class="login__form-col">
      <div class="login__form">
        <!-- Brand -->
        <div class="login__brand">
          <!-- Extend X logo (inline SVG, gradient) -->
          <img
            src="https://storage.googleapis.com/extend-platform/content/conversational-cloud.png"
            alt=""
            class="login__logo-svg"
            style="
              filter: drop-shadow(0 6px 20px rgba(141, 70, 235, 0.35));
              height: 52px;
              width: 52px;
              border-radius: 14px;
            "
          />
          <!-- <svg width="52" height="52" viewBox="0 0 52 52" fill="none" class="login__logo-svg">
            <defs>
              <linearGradient id="lg-x" x1="0" y1="0" x2="52" y2="52" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="#8b5cf6"/>
                <stop offset="100%" stop-color="#d946ef"/>
              </linearGradient>
            </defs>
            <rect width="52" height="52" rx="14" fill="url(#lg-x)" opacity="0.15"/>
            <path d="M14 14 L26 26 L14 38 M38 14 L26 26 L38 38" stroke="url(#lg-x)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg> -->
          <div class="login__brand-name">Agent Console</div>
          <div class="login__brand-sub">
            Sign in with your LivePerson account
          </div>
        </div>

        <!-- SSO / Password tabs -->
        <div class="login__tabs">
          <button
            :class="['login__tab', { 'login__tab--active': mode === 'sso' }]"
            @click="mode = 'sso'"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            SSO
          </button>
          <button
            :class="[
              'login__tab',
              { 'login__tab--active': mode === 'password' },
            ]"
            @click="mode = 'password'"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            Password
          </button>
        </div>

        <!-- Saved accounts -->
        <div v-if="savedAccounts.length" class="login__saved">
          <div class="login__label">Saved accounts</div>
          <div class="login__chips">
            <button
              v-for="a in savedAccounts"
              :key="a"
              class="login__chip"
              @click="accountId = a"
            >
              {{ a }}
            </button>
          </div>
        </div>

        <!-- Account ID -->
        <label class="login__field">
          <span class="login__label">LP Account ID</span>
          <input
            v-model="accountId"
            class="login__input"
            placeholder="e.g. 12345678"
            inputmode="numeric"
            @keyup.enter="submit"
          />
        </label>

        <!-- Password-mode extras -->
        <template v-if="mode === 'password'">
          <label class="login__field">
            <span class="login__label">Login name</span>
            <input
              v-model="username"
              class="login__input"
              placeholder="username"
              autocomplete="username"
            />
          </label>
          <label class="login__field">
            <span class="login__label">Password</span>
            <input
              v-model="password"
              type="password"
              class="login__input"
              placeholder="••••••••"
              autocomplete="current-password"
              @keyup.enter="submit"
            />
          </label>
          <div class="login__warn">
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              style="flex-shrink: 0; margin-top: 1px"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            Password sign-in may end other CCUI sessions. SSO avoids this.
          </div>
        </template>

        <!-- CTA -->
        <button
          class="login__cta"
          :disabled="busy || !accountId"
          @click="submit"
        >
          <svg
            v-if="mode === 'sso'"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
            />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
          {{
            busy
              ? "Signing in…"
              : mode === "sso"
                ? "Sign in via browser"
                : "Sign in"
          }}
        </button>

        <div v-if="mode === 'sso'" class="login__hint">
          Opens LivePerson to finish login. Don't have SSO yet? Sign in with a
          password, then enable SSO from your account.
        </div>

        <div v-if="error" class="login__error">
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {{ error }}
        </div>
      </div>

      <div class="login__foot">
        Extend Agent Console — LivePerson Messaging SDK
      </div>
    </div>

    <!-- ── Right: workspace preview ──────────────────────────── -->
    <div class="login__preview-col">
      <!-- Blueprint grid background -->
      <div class="login__bp-bg">
        <svg class="login__bp-grid" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern
              id="lp-small"
              width="40"
              height="40"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 40 0 L 0 0 0 40"
                fill="none"
                stroke="rgba(232,73,183,0.04)"
                stroke-width="0.5"
              />
            </pattern>
            <pattern
              id="lp-large"
              width="200"
              height="200"
              patternUnits="userSpaceOnUse"
            >
              <rect width="200" height="200" fill="url(#lp-small)" />
              <path
                d="M 200 0 L 0 0 0 200"
                fill="none"
                stroke="rgba(232,73,183,0.08)"
                stroke-width="1"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#lp-large)" />
        </svg>
        <!-- Glow orbs -->
        <div class="login__orb login__orb--pink" style="top: 10%; left: 15%" />
        <div
          class="login__orb login__orb--purple"
          style="bottom: 15%; right: 10%"
        />
        <div class="login__orb login__orb--cyan" style="top: 55%; left: 55%" />
      </div>

      <!-- Floating workspace mockup -->
      <div class="login__mockup">
        <!-- Mini workspace chrome -->
        <div class="login__ws">
          <!-- Rail -->
          <div class="login__ws-rail">
            <div class="login__ws-dot login__ws-dot--on" />
            <div class="login__ws-avatar">B</div>
          </div>
          <!-- Conv list -->
          <div class="login__ws-list">
            <div class="login__ws-listhead">
              My Conversations <span>4</span>
            </div>
            <div
              v-for="i in 4"
              :key="i"
              class="login__ws-convo"
              :class="i === 2 ? 'login__ws-convo--active' : ''"
            >
              <div
                class="login__ws-avatar-sm"
                :style="`background:hsl(${i * 67 + 200},60%,40%)`"
              >
                V
              </div>
              <div class="login__ws-convo-body">
                <div class="login__ws-convo-name">Visitor</div>
                <div class="login__ws-convo-preview">
                  {{
                    [
                      "Hi, I need help with...",
                      "Can you check my order?",
                      "Thanks, that worked!",
                      "What are your hours?",
                    ][i - 1]
                  }}
                </div>
                <div class="login__ws-tag">web-sales</div>
              </div>
            </div>
          </div>
          <!-- Thread -->
          <div class="login__ws-thread">
            <div class="login__ws-thread-head">09d898…b656</div>
            <div class="login__ws-msgs">
              <div class="login__ws-msg login__ws-msg--visitor">
                Hi, I need help finding the right plan
              </div>
              <div class="login__ws-msg login__ws-msg--agent">
                Hi there! I'm here to help you find the best value. Quick
                question — do you currently have cover?
              </div>
              <div class="login__ws-msg login__ws-msg--visitor">
                Not yet, first time looking
              </div>
              <div class="login__ws-msg login__ws-msg--agent">
                Perfect, let me pull up our starter options for you.
              </div>
            </div>
            <!-- Composer -->
            <div class="login__ws-composer">
              <div class="login__ws-composer-fmt">
                <span>B</span><span><em>I</em></span
                ><span>U</span><span>🔗</span>
              </div>
              <div class="login__ws-composer-input">Type a message…</div>
              <div class="login__ws-composer-row">
                <span class="login__ws-pill">Rewrite</span>
                <span class="login__ws-pill">Translate</span>
                <div style="flex: 1" />
                <div class="login__ws-send">Send</div>
              </div>
            </div>
          </div>
          <!-- Right panel -->
          <div class="login__ws-panel">
            <div class="login__ws-panel-tabs">
              <span class="login__ws-panel-tab login__ws-panel-tab--on"
                >Customer</span
              >
              <span class="login__ws-panel-tab">Notes</span>
              <span class="login__ws-panel-tab">Canned</span>
            </div>
            <div class="login__ws-panel-rows">
              <div class="login__ws-panel-row">
                <span>Name</span><span>Visitor</span>
              </div>
              <div class="login__ws-panel-row">
                <span>Device</span><span>Desktop</span>
              </div>
              <div class="login__ws-panel-row">
                <span>Browser</span><span>Chrome</span>
              </div>
              <div class="login__ws-panel-row">
                <span>Skill</span><span>web-sales</span>
              </div>
              <div class="login__ws-panel-row">
                <span>Country</span><span>Australia</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Eyebrow text -->
      <div class="login__preview-text">
        <div class="login__preview-eyebrow">Extend Agent Console</div>
        <div class="login__preview-headline">
          Modern agent workspace<br />for Conversational Cloud
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Layout ─────────────────────────────────────────────────────── */
.login {
  display: grid;
  grid-template-columns: 440px 1fr;
  min-height: 100vh;
  background: #0a0a12;
}
@media (max-width: 860px) {
  .login {
    grid-template-columns: 1fr;
  }
  .login__preview-col {
    display: none;
  }
}

/* ── Form column ─────────────────────────────────────────────────── */
.login__form-col {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 32px 52px;
  background:
    radial-gradient(
      120% 90% at 100% 30%,
      rgba(141, 70, 235, 0.16),
      transparent 55%
    ),
    radial-gradient(
      110% 80% at 90% 100%,
      rgba(65, 105, 232, 0.12),
      transparent 60%
    ),
    linear-gradient(180deg, #0a0a12 0%, #07070d 100%);
}
.login__form-col::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    radial-gradient(1px 1px at 20% 30%, rgba(255, 255, 255, 0.25), transparent),
    radial-gradient(1px 1px at 70% 60%, rgba(255, 255, 255, 0.18), transparent),
    radial-gradient(1px 1px at 40% 80%, rgba(168, 184, 232, 0.2), transparent),
    radial-gradient(1px 1px at 85% 20%, rgba(255, 255, 255, 0.15), transparent);
  opacity: 0.6;
}

.login__form {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 360px;
  margin: 0 auto;
}

/* Brand */
.login__brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  margin-bottom: 28px;
}
.login__logo-svg {
  margin-bottom: 16px;
  filter: drop-shadow(0 6px 20px rgba(141, 70, 235, 0.35));
}
.login__brand-name {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.025em;
  color: #fff;
}
.login__brand-sub {
  font-size: 13px;
  color: #8a8a99;
  margin-top: 5px;
}

/* Tabs */
.login__tabs {
  display: flex;
  gap: 3px;
  padding: 4px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.07);
  margin-bottom: 18px;
}
.login__tab {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 0;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: rgba(255, 255, 255, 0.55);
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.12s;
}
.login__tab:hover {
  color: rgba(255, 255, 255, 0.8);
}
.login__tab--active {
  background: linear-gradient(
    180deg,
    rgba(141, 70, 235, 0.22),
    rgba(141, 70, 235, 0.12)
  );
  color: #fff;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.08) inset,
    0 2px 8px rgba(141, 70, 235, 0.25);
}

/* Saved */
.login__saved {
  margin-bottom: 14px;
}
.login__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}
.login__chip {
  padding: 5px 11px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.03);
  color: rgba(255, 255, 255, 0.7);
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.12s;
}
.login__chip:hover {
  border-color: rgba(141, 70, 235, 0.5);
  color: #fff;
  background: rgba(141, 70, 235, 0.1);
}

/* Fields */
.login__field {
  display: block;
  margin-bottom: 12px;
}
.login__label {
  display: block;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #8a8a99;
  margin-bottom: 5px;
}
.login__input {
  width: 100%;
  padding: 11px 13px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  color: #fff;
  font-family: inherit;
  font-size: 14px;
  outline: none;
  transition:
    border-color 0.12s,
    box-shadow 0.12s,
    background 0.12s;
  box-sizing: border-box;
}
.login__input::placeholder {
  color: rgba(255, 255, 255, 0.35);
}
.login__input:focus {
  border-color: rgba(141, 70, 235, 0.7);
  background: rgba(255, 255, 255, 0.06);
  box-shadow: 0 0 0 3px rgba(141, 70, 235, 0.18);
}

.login__warn {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-top: 2px;
  font-size: 11px;
  line-height: 1.5;
  color: #8a8a99;
}

/* CTA */
.login__cta {
  width: 100%;
  margin-top: 18px;
  padding: 12px;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  background: linear-gradient(135deg, #8b5cf6, #d946ef);
  color: #fff;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  box-shadow: 0 6px 22px rgba(141, 70, 235, 0.4);
  transition:
    box-shadow 0.12s,
    transform 0.12s,
    opacity 0.12s;
}
.login__cta:hover:not(:disabled) {
  box-shadow: 0 8px 30px rgba(141, 70, 235, 0.55);
  transform: translateY(-1px);
}
.login__cta:active:not(:disabled) {
  transform: translateY(0);
}
.login__cta:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.login__hint {
  margin-top: 14px;
  font-size: 11.5px;
  line-height: 1.5;
  color: #8a8a99;
  text-align: center;
}

.login__error {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 14px;
  padding: 9px 11px;
  border-radius: 8px;
  background: rgba(239, 68, 68, 0.1);
  color: #f87171;
  font-size: 12px;
}

.login__foot {
  position: absolute;
  bottom: 24px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 11px;
  color: #8a8a99;
}

/* ── Preview column ──────────────────────────────────────────────── */
.login__preview-col {
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(
      ellipse at 20% 80%,
      rgba(232, 73, 183, 0.1) 0%,
      transparent 50%
    ),
    radial-gradient(
      ellipse at 80% 20%,
      rgba(49, 204, 236, 0.07) 0%,
      transparent 50%
    ),
    radial-gradient(
      ellipse at 50% 50%,
      rgba(141, 70, 235, 0.06) 0%,
      transparent 60%
    ),
    linear-gradient(180deg, #0e0a1f 0%, #16112d 100%);
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Blueprint bg */
.login__bp-bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.login__bp-grid {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

/* Orbs */
.login__orb {
  position: absolute;
  width: 280px;
  height: 280px;
  border-radius: 50%;
  filter: blur(90px);
  opacity: 0.2;
  animation: orb-pulse 8s ease-in-out infinite;
}
.login__orb--sm {
  width: 160px;
  height: 160px;
}
.login__orb--pink {
  background: #e849b7;
}
.login__orb--cyan {
  background: #31ccec;
  animation-delay: 2s;
}
.login__orb--purple {
  background: #8d46eb;
  animation-delay: 4s;
}
@keyframes orb-pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.2;
  }
  50% {
    transform: scale(1.08);
    opacity: 0.26;
  }
}

/* Mockup */
.login__mockup {
  position: relative;
  z-index: 1;
  width: min(820px, 90%);
  border-radius: 12px;
  overflow: hidden;
  box-shadow:
    0 32px 80px rgba(0, 0, 0, 0.6),
    0 0 0 1px rgba(232, 73, 183, 0.12);
  transform: perspective(1200px) rotateX(4deg) rotateY(-3deg);
}

/* Workspace chrome */
.login__ws {
  display: grid;
  grid-template-columns: 44px 200px 1fr 180px;
  height: 440px;
  font-size: 11px;
  overflow: hidden;
}

/* Rail */
.login__ws-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  padding-bottom: 12px;
  gap: 8px;
  background: rgba(28, 21, 56, 0.95);
  border-right: 1px solid rgba(232, 73, 183, 0.08);
}
.login__ws-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #6b7280;
}
.login__ws-dot--on {
  background: #34d399;
}
.login__ws-avatar {
  width: 28px;
  height: 28px;
  border-radius: 7px;
  background: rgba(147, 51, 234, 0.2);
  border: 1px solid rgba(147, 51, 234, 0.3);
  color: #a78bfa;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Conv list */
.login__ws-list {
  background: rgba(28, 21, 56, 0.8);
  border-right: 1px solid rgba(232, 73, 183, 0.08);
  overflow: hidden;
}
.login__ws-listhead {
  padding: 8px 10px;
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: rgba(255, 255, 255, 0.3);
  border-bottom: 1px solid rgba(232, 73, 183, 0.07);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.login__ws-listhead span {
  background: rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  padding: 1px 6px;
  font-size: 9px;
}
.login__ws-convo {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  padding: 7px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
  cursor: default;
}
.login__ws-convo--active {
  background: rgba(147, 51, 234, 0.12);
}
.login__ws-avatar-sm {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.7);
  font-size: 10px;
  font-weight: 700;
}
.login__ws-convo-body {
  min-width: 0;
}
.login__ws-convo-name {
  color: rgba(255, 255, 255, 0.8);
  font-weight: 600;
  font-size: 10px;
}
.login__ws-convo-preview {
  color: rgba(255, 255, 255, 0.35);
  font-size: 9px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 130px;
}
.login__ws-tag {
  display: inline-block;
  margin-top: 3px;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 8px;
  font-weight: 600;
  background: rgba(147, 51, 234, 0.15);
  color: #a78bfa;
  border: 1px solid rgba(147, 51, 234, 0.2);
}

/* Thread */
.login__ws-thread {
  display: flex;
  flex-direction: column;
  background: rgba(17, 14, 36, 0.5);
  border-right: 1px solid rgba(232, 73, 183, 0.08);
  overflow: hidden;
}
.login__ws-thread-head {
  padding: 8px 12px;
  font-size: 10px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.5);
  background: rgba(28, 21, 56, 0.6);
  border-bottom: 1px solid rgba(232, 73, 183, 0.07);
}
.login__ws-msgs {
  flex: 1;
  padding: 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow: hidden;
}
.login__ws-msg {
  max-width: 80%;
  padding: 6px 9px;
  border-radius: 8px;
  font-size: 9.5px;
  line-height: 1.4;
  color: rgba(255, 255, 255, 0.75);
}
.login__ws-msg--visitor {
  align-self: flex-start;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.07);
}
.login__ws-msg--agent {
  align-self: flex-end;
  background: rgba(147, 51, 234, 0.15);
  border: 1px solid rgba(147, 51, 234, 0.22);
  color: #c4b8e0;
}

/* Composer */
.login__ws-composer {
  background: rgba(28, 21, 56, 0.85);
  border-top: 1px solid rgba(232, 73, 183, 0.08);
  padding: 6px 8px;
}
.login__ws-composer-fmt {
  display: flex;
  gap: 4px;
  padding-bottom: 5px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.25);
  font-size: 10px;
}
.login__ws-composer-fmt span {
  padding: 1px 4px;
}
.login__ws-composer-input {
  padding: 6px 0;
  color: rgba(255, 255, 255, 0.2);
  font-size: 10px;
}
.login__ws-composer-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
}
.login__ws-pill {
  padding: 2px 7px;
  border-radius: 4px;
  font-size: 8.5px;
  font-weight: 600;
  background: rgba(147, 51, 234, 0.15);
  border: 1px solid rgba(147, 51, 234, 0.25);
  color: #a78bfa;
}
.login__ws-send {
  padding: 3px 10px;
  border-radius: 5px;
  font-size: 9px;
  font-weight: 700;
  background: linear-gradient(135deg, #8b5cf6, #d946ef);
  color: #fff;
}

/* Right panel */
.login__ws-panel {
  background: rgba(28, 21, 56, 0.72);
  overflow: hidden;
}
.login__ws-panel-tabs {
  display: flex;
  gap: 2px;
  padding: 5px 6px;
  border-bottom: 1px solid rgba(232, 73, 183, 0.07);
}
.login__ws-panel-tab {
  padding: 3px 7px;
  border-radius: 5px;
  font-size: 9px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.35);
  cursor: default;
}
.login__ws-panel-tab--on {
  background: rgba(147, 51, 234, 0.15);
  color: #a78bfa;
  border: 1px solid rgba(147, 51, 234, 0.2);
}
.login__ws-panel-rows {
  padding: 8px 8px;
}
.login__ws-panel-row {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
  font-size: 9px;
}
.login__ws-panel-row span:first-child {
  color: rgba(255, 255, 255, 0.3);
}
.login__ws-panel-row span:last-child {
  color: rgba(255, 255, 255, 0.65);
  font-weight: 500;
}

/* Preview text overlay */
.login__preview-text {
  position: absolute;
  left: 48px;
  bottom: 48px;
  right: 48px;
  z-index: 2;
  color: #fff;
}
.login__preview-eyebrow {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  opacity: 0.7;
  margin-bottom: 10px;
}
.login__preview-headline {
  font-size: 28px;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: -0.025em;
  background: linear-gradient(135deg, #e8e0f0 30%, #d946ef);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
</style>
