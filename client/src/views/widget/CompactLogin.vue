<script setup lang="ts">
import { ref, onBeforeUnmount } from "vue";
import { api, type Me } from "../../lib/api";

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

let popup: Window | null = null;
function onMessage(e: MessageEvent) {
  if (e.origin !== window.location.origin) return;
  const data = e.data as { type?: string; me?: Me } | undefined;
  if (data?.type === "acw-sso-complete" && data.me) {
    busy.value = false;
    emit("signed-in", data.me);
  }
}
window.addEventListener("message", onMessage);
onBeforeUnmount(() => window.removeEventListener("message", onMessage));

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
      // SSO via popup — LP's login page can't be framed, so open a top-level
      // window. It lands on the dedicated /widget/callback page (served by the same
      // backend), completes the exchange, and postMessages the session back here.
      // /widget/callback resolves in both dev (Vite rewrite) and prod (server).
      const redirect = `${window.location.origin}/widget/callback`;
      const { url } = await api.ssoUrl(accountId.value.trim(), redirect);
      popup = window.open(url, "acw-sso", "width=520,height=680");
      if (!popup) {
        error.value = "Popup blocked — allow popups for SSO sign-in.";
        busy.value = false;
      }
      // busy stays true until the popup posts back (onMessage) or the user retries.
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    busy.value = false;
  }
}
</script>

<template>
  <div class="cl">
    <div class="cl__brand">
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
      <!-- <svg width="44" height="44" viewBox="0 0 52 52" fill="none">
        <defs>
          <linearGradient id="cl-x" x1="0" y1="0" x2="52" y2="52" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#8b5cf6" />
            <stop offset="100%" stop-color="#d946ef" />
          </linearGradient>
        </defs>
        <rect width="52" height="52" rx="14" fill="url(#cl-x)" opacity="0.15" />
        <path
          d="M14 14 L26 26 L14 38 M38 14 L26 26 L38 38"
          stroke="url(#cl-x)"
          stroke-width="4"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg> -->
      <div class="cl__title">Agent Widget</div>
      <div class="cl__sub">Sign in with your LivePerson account</div>
    </div>

    <div class="cl__tabs">
      <button
        :class="['cl__tab', { 'cl__tab--on': mode === 'sso' }]"
        @click="mode = 'sso'"
      >
        SSO
      </button>
      <button
        :class="['cl__tab', { 'cl__tab--on': mode === 'password' }]"
        @click="mode = 'password'"
      >
        Password
      </button>
    </div>

    <div v-if="savedAccounts.length" class="cl__saved">
      <button
        v-for="a in savedAccounts"
        :key="a"
        class="cl__chip"
        @click="accountId = a"
      >
        {{ a }}
      </button>
    </div>

    <label class="cl__field">
      <span class="wg-label">LP Account ID</span>
      <input
        v-model="accountId"
        class="wg-input"
        placeholder="e.g. 12345678"
        inputmode="numeric"
        @keyup.enter="submit"
      />
    </label>

    <template v-if="mode === 'password'">
      <label class="cl__field">
        <span class="wg-label">Login name</span>
        <input
          v-model="username"
          class="wg-input"
          placeholder="username"
          autocomplete="username"
        />
      </label>
      <label class="cl__field">
        <span class="wg-label">Password</span>
        <input
          v-model="password"
          type="password"
          class="wg-input"
          placeholder="••••••••"
          autocomplete="current-password"
          @keyup.enter="submit"
        />
      </label>
    </template>

    <button
      class="wg-cta cl__cta"
      :disabled="busy || !accountId"
      @click="submit"
    >
      {{
        busy
          ? "Signing in…"
          : mode === "sso"
            ? "Sign in via browser"
            : "Sign in"
      }}
    </button>

    <div v-if="mode === 'sso'" class="cl__hint">
      Opens LivePerson in a popup to finish login.
    </div>

    <div v-if="error" class="cl__error">{{ error }}</div>
  </div>
</template>

<style scoped>
.cl {
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 12px;
  padding: 28px 26px;
  background:
    radial-gradient(
      120% 80% at 50% 0%,
      rgba(141, 70, 235, 0.14),
      transparent 55%
    ),
    var(--bg-glow, var(--bg));
  overflow-y: auto;
}
.cl__brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  margin-bottom: 4px;
}
.cl__title {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text);
  margin-top: 10px;
}
.cl__sub {
  font-size: 12px;
  color: var(--text2);
  margin-top: 3px;
}
.cl__tabs {
  display: flex;
  gap: 3px;
  padding: 4px;
  border-radius: 10px;
  background: var(--surf-input);
  border: 1px solid var(--border2);
}
.cl__tab {
  flex: 1;
  padding: 7px 0;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text2);
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.cl__tab--on {
  background: var(--acc-tint);
  color: var(--acc);
}
.cl__saved {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.cl__chip {
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: transparent;
  color: var(--text2);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.cl__chip:hover {
  border-color: var(--acc-border);
  color: var(--text);
}
.cl__field {
  display: block;
}
.cl__field .wg-label {
  display: block;
  margin-bottom: 4px;
}
.cl__cta {
  margin-top: 6px;
  width: 100%;
  padding: 11px;
}
.cl__hint {
  font-size: 11px;
  color: var(--text2);
  text-align: center;
}
.cl__error {
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(239, 68, 68, 0.1);
  color: #f87171;
  font-size: 12px;
}
</style>
