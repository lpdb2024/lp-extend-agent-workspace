<script setup lang="ts">
import { ref, onMounted } from 'vue';
import Login from './views/Login.vue';
import Workspace from './views/Workspace.vue';
import { api, type Me } from './lib/api';

const me = ref<Me | null>(null);
const loading = ref(true);
const authError = ref<string | null>(null);

const theme = ref<'dark' | 'light'>(
  (localStorage.getItem('acw-theme') as 'dark' | 'light') ?? 'dark'
);
function syncBodyTheme(t: string) {
  document.body.setAttribute('data-theme', t);
}
function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark';
  localStorage.setItem('acw-theme', theme.value);
  syncBodyTheme(theme.value);
}

onMounted(async () => {
  syncBodyTheme(theme.value);
  // SSO return: LP redirected back to /callback?code=&state=
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (window.location.pathname === '/callback' && code && state) {
    try {
      me.value = await api.ssoCallback(state, code, `${window.location.origin}/callback`);
    } catch (e) {
      authError.value = e instanceof Error ? e.message : String(e);
    } finally {
      // Strip the code/state from the URL and return to root.
      window.history.replaceState({}, '', '/');
      loading.value = false;
    }
    return;
  }

  try {
    me.value = await api.me();
  } catch {
    me.value = null;
  } finally {
    loading.value = false;
  }
});

function onSignedIn(m: Me) {
  me.value = m;
}
async function onSignOut() {
  await api.logout().catch(() => {});
  me.value = null;
}
</script>

<template>
  <div :data-theme="theme" class="h-full">
    <div v-if="loading" class="h-full grid place-items-center" style="color:var(--text3);">
      <div class="animate-pulse">Connecting…</div>
    </div>
    <Workspace v-else-if="me" :me="me" :theme="theme" @sign-out="onSignOut" @toggle-theme="toggleTheme" />
    <Login v-else :initial-error="authError" @signed-in="onSignedIn" />
  </div>
</template>
