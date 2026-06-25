<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import CompactLogin from './views/widget/CompactLogin.vue';
import WidgetWorkspace from './views/widget/WidgetWorkspace.vue';
import SsoCallback from './views/widget/SsoCallback.vue';
import { api, type Me } from './lib/api';

const me = ref<Me | null>(null);
const loading = ref(true);
const authError = ref<string | null>(null);

// SSO-callback mode: this window is the popup landing on /widget/callback. We render
// the styled callback page (not the widget), complete the exchange, and post back.
const isCallback = window.location.pathname.replace(/\/+$/, '').endsWith('/widget/callback');
const callbackStatus = ref<'working' | 'error'>('working');

const theme = ref<'dark' | 'light'>(
  (localStorage.getItem('acw-theme') as 'dark' | 'light') ?? 'dark',
);
function syncBodyTheme(t: string) {
  document.body.setAttribute('data-theme', t);
}
function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark';
  localStorage.setItem('acw-theme', theme.value);
  syncBodyTheme(theme.value);
}

// The SSO popup posts its completed session back here (cross-window). Accept only
// same-origin messages carrying our marker.
function onMessage(e: MessageEvent) {
  if (e.origin !== window.location.origin) return;
  const data = e.data as { type?: string; me?: Me } | undefined;
  if (data?.type === 'acw-sso-complete' && data.me) {
    me.value = data.me;
    authError.value = null;
  }
}

async function runCallback() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) {
    callbackStatus.value = 'error';
    authError.value = 'Missing authorization code.';
    return;
  }
  try {
    // redirect_uri must match exactly what CompactLogin requested (this path).
    const redirect = `${window.location.origin}${window.location.pathname}`;
    const session = await api.ssoCallback(state, code, redirect);
    if (window.opener) {
      window.opener.postMessage({ type: 'acw-sso-complete', me: session }, window.location.origin);
      window.close();
      return;
    }
    // Opened in the same tab (not a popup) — fall through to use the session here.
    me.value = session;
    window.history.replaceState({}, '', '/widget');
  } catch (e) {
    callbackStatus.value = 'error';
    authError.value = e instanceof Error ? e.message : String(e);
  }
}

onMounted(async () => {
  document.body.classList.add('widget-standalone');
  syncBodyTheme(theme.value);

  if (isCallback) {
    await runCallback();
    loading.value = false;
    return;
  }

  window.addEventListener('message', onMessage);
  try {
    me.value = await api.me();
  } catch {
    me.value = null;
  } finally {
    loading.value = false;
  }
});

onBeforeUnmount(() => window.removeEventListener('message', onMessage));

function onSignedIn(m: Me) {
  me.value = m;
}
async function onSignOut() {
  await api.logout().catch(() => {});
  me.value = null;
}
</script>

<template>
  <div :data-theme="theme" class="wg-root">
    <!-- SSO popup landing page -->
    <SsoCallback
      v-if="isCallback && !me"
      :status="callbackStatus"
      :message="authError"
    />

    <template v-else>
      <div v-if="loading" class="h-full grid place-items-center" style="color: var(--text3)">
        <div class="animate-pulse" style="font-size: 13px">Connecting…</div>
      </div>
      <WidgetWorkspace
        v-else-if="me"
        :me="me"
        :theme="theme"
        @sign-out="onSignOut"
        @toggle-theme="toggleTheme"
      />
      <CompactLogin v-else :initial-error="authError" @signed-in="onSignedIn" />
    </template>
  </div>
</template>
