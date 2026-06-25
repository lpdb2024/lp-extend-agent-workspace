<script setup lang="ts">
// Shown in the SSO POPUP window (a top-level window — LP's login can't be iframed).
// Completes the OAuth code exchange, hands the session to the opener (the iframed
// widget) via postMessage, then closes. Styled to match the widget.
defineProps<{ status: 'working' | 'error'; message?: string | null }>();
function closeWin() {
  window.close();
}
</script>

<template>
  <div class="cb">
    <div class="cb__brand">
      <img
        src="https://storage.googleapis.com/extend-platform/content/conversational-cloud.png"
        class="cb__logo"
        alt=""
      />
    </div>
    <template v-if="status === 'working'">
      <div class="cb__spin" />
      <div class="cb__title">Signing you in…</div>
      <div class="cb__sub">Completing secure sign-in with LivePerson</div>
    </template>
    <template v-else>
      <div class="cb__err-icon">!</div>
      <div class="cb__title">Sign-in failed</div>
      <div class="cb__sub">{{ message || 'Please close this window and try again.' }}</div>
      <button class="cb__close" @click="closeWin">Close</button>
    </template>
  </div>
</template>

<style scoped>
.cb {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 32px;
  text-align: center;
  background:
    radial-gradient(120% 80% at 50% 0%, rgba(141, 70, 235, 0.16), transparent 55%),
    var(--bg-glow, var(--bg));
}
.cb__brand {
  margin-bottom: 6px;
}
.cb__logo {
  width: 44px;
  height: 44px;
  border-radius: 11px;
  object-fit: contain;
}
.cb__spin {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 3px solid var(--acc-border);
  border-top-color: var(--acc);
  animation: cb-spin 0.9s linear infinite;
}
@keyframes cb-spin {
  to {
    transform: rotate(360deg);
  }
}
.cb__err-icon {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 22px;
  font-weight: 800;
  color: #fff;
  background: #ef4444;
}
.cb__title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
}
.cb__sub {
  font-size: 13px;
  color: var(--text2);
  max-width: 280px;
  line-height: 1.5;
}
.cb__close {
  margin-top: 6px;
  padding: 9px 18px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--surf-input);
  color: var(--text);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
</style>
