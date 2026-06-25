<script setup lang="ts">
import { ref } from 'vue';
import Icon from '../../components/Icon.vue';
import type { WorkspaceStore } from '../../composables/workspace-store';

const props = defineProps<{ w: WorkspaceStore; theme?: 'dark' | 'light' }>();
const emit = defineEmits<{ (e: 'open-switcher'): void }>();
const w = props.w;

const menuOpen = ref(false);

// Hover tooltip (customer name + last 6 messages), like the console.
const hoverId = ref<string | null>(null);
const hoverY = ref(0);
let hoverTimer: ReturnType<typeof setTimeout> | null = null;

function toggleMenu() {
  menuOpen.value = !menuOpen.value;
  if (menuOpen.value) w.loadStatusReasons();
}
function pick(id: string) {
  w.selectConversation(id);
}

/** A conversation needs attention: an unread count, or the customer sent the last
 * message (awaiting the agent's reply). */
function hasUnread(c: { unread: number; lastMessageFromConsumer: boolean }): boolean {
  return c.unread > 0 || c.lastMessageFromConsumer;
}

function onAvatarEnter(e: MouseEvent, id: string) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  hoverY.value = rect.top;
  if (hoverTimer) clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => {
    hoverId.value = id;
    void w.loadTranscript(id);
  }, 250);
}
function onAvatarLeave() {
  if (hoverTimer) clearTimeout(hoverTimer);
  hoverId.value = null;
}
function hoverName(id: string): string {
  return w.conversations.find((c) => c.conversationId === id)?.consumerName ?? 'Conversation';
}
</script>

<template>
  <nav class="rail">
    <!-- Brand / connection -->
    <div class="rail__top">
      <img
        src="https://storage.googleapis.com/extend-platform/content/conversational-cloud.png"
        class="rail__logo"
        alt="Conversational Cloud"
      />
      <span
        class="rail__dot"
        :style="{ background: w.connected.value ? w.currentStateColor.value : '#6b7280' }"
        :title="w.connected.value ? w.agentState.value.replace('_', ' ').toLowerCase() : 'Disconnected'"
      />
    </div>

    <!-- Conversation switcher (opens the full list) -->
    <button class="wg-btn rail__btn" title="All conversations" @click="emit('open-switcher')">
      <Icon name="chat" :size="17" />
      <span v-if="w.counts.value.overdue + w.counts.value.urgent" class="rail__badge">
        {{ w.counts.value.overdue + w.counts.value.urgent }}
      </span>
    </button>

    <div class="rail__div" />

    <!-- Conversation avatars (quick-switch) — fills the remaining space -->
    <div class="rail__convos">
      <button
        v-for="c in w.visibleConversations.value"
        :key="c.conversationId"
        class="rail__convo"
        :class="{
          'rail__convo--on': c.conversationId === w.activeId.value,
          'rail__convo--unread': hasUnread(c) && c.conversationId !== w.activeId.value,
        }"
        :style="w.avatarStyle(c.conversationId)"
        @click="pick(c.conversationId)"
        @mouseenter="onAvatarEnter($event, c.conversationId)"
        @mouseleave="onAvatarLeave"
      >
        {{ w.initials(c.consumerName) }}
        <span
          class="rail__convo-dot"
          :class="`rail__convo-dot--${w.liveStatus(c)}`"
        />
        <!-- Unread badge: a new customer message awaits a reply -->
        <span
          v-if="hasUnread(c) && c.conversationId !== w.activeId.value"
          class="rail__convo-unread"
        >
          {{ c.unread > 0 ? c.unread : '' }}
        </span>
      </button>
    </div>

    <!-- Auth / state menu (anchored at the very bottom, big margin above) -->
    <div class="rail__auth">
      <button
        class="rail__avatar"
        :class="{ 'rail__avatar--on': menuOpen }"
        :title="w.me.loginName"
        @click.stop="toggleMenu"
      >
        <img
          v-if="w.me.imageUrl"
          :src="w.me.imageUrl"
          class="rail__avatar-img"
          alt=""
        />
        <span v-else>{{ w.initials(w.me.displayName || w.me.loginName) }}</span>
        <span class="rail__avatar-state" :style="{ background: w.currentStateColor.value }" />
      </button>
    </div>

    <!-- Menu is teleported to body so it renders ABOVE the chat/overlays -->
    <Teleport to="body">
      <Transition name="wg-fade">
        <div
          v-if="menuOpen"
          class="rail-menu"
          :data-theme="theme"
          @click.stop
        >
          <!-- Identity -->
          <div class="rail-menu__head">
            <div class="rail-menu__avatar" :style="w.me.imageUrl ? '' : { background: w.currentStateColor.value }">
              <img v-if="w.me.imageUrl" :src="w.me.imageUrl" class="rail-menu__avatar-img" alt="" />
              <span v-else>{{ w.initials(w.me.displayName || w.me.loginName) }}</span>
            </div>
            <div class="rail-menu__who">
              <div class="rail-menu__name">{{ w.me.displayName || w.me.loginName }}</div>
              <div class="rail-menu__acct">Account {{ w.me.accountId }}</div>
            </div>
          </div>

          <div class="rail-menu__sep" />

          <!-- Availability states -->
          <div class="rail-menu__label">Availability</div>
          <div class="rail-menu__states">
            <button
              v-for="s in w.AVAIL_STATES"
              :key="s.key"
              class="rail-menu__state"
              :class="{ 'rail-menu__state--on': w.agentState.value === s.key }"
              :disabled="w.stateChanging.value"
              @click="w.changeState(s.key)"
            >
              <span class="rail-menu__pip" :style="{ background: s.color }" />
              {{ s.label }}
            </button>
          </div>

          <!-- Reason picker (AWAY / BACK_SOON) -->
          <div v-if="w.pendingState.value" class="rail-menu__reasons">
            <input
              v-model="w.reasonSearch.value"
              class="wg-input rail-menu__reason-search"
              placeholder="Pick a reason…"
            />
            <button
              v-for="r in w.filteredReasons.value"
              :key="r.id"
              class="rail-menu__reason"
              @click="w.applyState(w.pendingState.value!)"
            >
              {{ r.text }}
            </button>
            <button class="rail-menu__reason rail-menu__reason--skip" @click="w.applyState(w.pendingState.value!)">
              No reason
            </button>
          </div>

          <!-- Skills -->
          <template v-if="w.agentSkills.value.length">
            <div class="rail-menu__sep" />
            <div class="rail-menu__label">Skills ({{ w.agentSkills.value.length }})</div>
            <div class="rail-menu__skills">
              <span v-for="s in w.agentSkills.value.slice(0, 8)" :key="s.id" class="rail-menu__skill">
                {{ s.name }}
              </span>
              <span v-if="w.agentSkills.value.length > 8" class="rail-menu__skill">
                +{{ w.agentSkills.value.length - 8 }}
              </span>
            </div>
          </template>

          <div class="rail-menu__sep" />

          <button class="wg-menu-item" @click="w.doReturnToQueue(); menuOpen = false">
            <Icon name="undo" :size="14" /> Send all back to queue
          </button>
          <button class="wg-menu-item" @click="w.toggleTheme()">
            <Icon :name="theme === 'light' ? 'moon' : 'sun'" :size="14" />
            {{ theme === 'light' ? 'Dark theme' : 'Light theme' }}
          </button>
          <button class="wg-menu-item wg-menu-item--danger" @click="w.signOut(); menuOpen = false">
            <Icon name="log-out" :size="14" /> Sign out
          </button>
        </div>
      </Transition>
    </Teleport>
    <!-- Click-away backdrop for the teleported menu -->
    <Teleport to="body">
      <div v-if="menuOpen" class="rail-menu__backdrop" @click="menuOpen = false" />
    </Teleport>

    <!-- Conversation hover tooltip — name + last 6 messages -->
    <Teleport to="body">
      <Transition name="wg-fade">
        <div
          v-if="hoverId"
          class="rail-tip"
          :data-theme="theme"
          :style="{ top: `${hoverY}px` }"
        >
          <div class="rail-tip__name">{{ hoverName(hoverId) }}</div>
          <div class="rail-tip__sub">last {{ w.tooltipLines(hoverId).length }} messages</div>
          <div
            v-if="w.transcriptLoading[hoverId] && !w.tooltipLines(hoverId).length"
            class="rail-tip__empty"
          >
            Loading…
          </div>
          <div v-else-if="!w.tooltipLines(hoverId).length" class="rail-tip__empty">
            No messages yet.
          </div>
          <div v-else class="rail-tip__lines">
            <div v-for="(l, li) in w.tooltipLines(hoverId)" :key="li" class="rail-tip__line">
              <span class="rail-tip__who" :class="l.who === 'Customer' ? '' : 'rail-tip__who--agent'">
                {{ l.who }}:
              </span>
              <span class="rail-tip__body">{{ l.body }}</span>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </nav>
</template>

<style scoped>
.rail {
  width: 46px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 0 14px;
  gap: 7px;
  background: var(--surf-rail);
  border-right: 1px solid var(--border2);
  backdrop-filter: var(--blur-sm);
}
.rail__top {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
}
.rail__logo {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  object-fit: contain;
}
.rail__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.rail__btn {
  position: relative;
  width: 34px;
  height: 34px;
}
.rail__badge {
  position: absolute;
  top: -2px;
  right: -2px;
  min-width: 15px;
  height: 15px;
  padding: 0 4px;
  border-radius: 999px;
  background: #ef4444;
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  line-height: 15px;
  text-align: center;
}
.rail__div {
  width: 22px;
  height: 1px;
  background: var(--border2);
  margin: 1px 0;
}
/* Conversation avatar stack — fills remaining space, scrolls if many */
.rail__convos {
  flex: 1;
  min-height: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 9px;
  overflow-y: auto;
  /* Inner padding so the unread ring + badge (which extend ~7px beyond the avatar)
     aren't clipped by the scroll container (overflow-y forces x-clipping too). */
  padding: 8px 8px 10px;
  /* hide scrollbar but keep scroll */
  scrollbar-width: none;
}
.rail__convos::-webkit-scrollbar {
  display: none;
}
.rail__convo {
  position: relative;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  border: 2px solid transparent;
  cursor: pointer;
  opacity: 0.55; /* inactive conversations are dimmed */
  transition: transform 0.1s, opacity 0.12s, box-shadow 0.12s;
}
.rail__convo:hover {
  transform: scale(1.08);
  opacity: 0.85;
}
/* Unread (customer waiting): full brightness + a red ring so it stands out. */
.rail__convo--unread {
  opacity: 1;
  box-shadow: 0 0 0 2px var(--surf-rail), 0 0 0 4px #ef4444;
}
.rail__convo-unread {
  position: absolute;
  top: -3px;
  right: -3px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 999px;
  background: #ef4444;
  border: 2px solid var(--surf-rail);
  color: #fff;
  font-size: 8px;
  font-weight: 700;
  line-height: 12px;
  text-align: center;
  box-sizing: content-box;
}
/* Active/selected conversation: full brightness + accent ring + a left pill. */
.rail__convo--on {
  opacity: 1;
  box-shadow: 0 0 0 2px var(--surf-rail), 0 0 0 4px var(--acc);
}
.rail__convo--on::before {
  content: '';
  position: absolute;
  left: -11px;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 20px;
  border-radius: 0 3px 3px 0;
  background: var(--acc);
}
.rail__convo-dot {
  position: absolute;
  bottom: -1px;
  right: -1px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 2px solid var(--surf-rail);
}
.rail__convo-dot--overdue {
  background: #f43f5e;
}
.rail__convo-dot--urgent {
  background: #f59e0b;
}
.rail__convo-dot--active {
  background: #34d399;
}
.rail__convo-dot--queued {
  background: #fb923c;
}
.rail__convo-dot--idle {
  background: #64748b;
}
/* Bottom avatar — big margin above is provided by the flex stack + this margin */
.rail__auth {
  margin-top: 10px;
}
.rail__avatar {
  position: relative;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: var(--acc-tint);
  border: 1px solid var(--acc-border);
  color: var(--acc);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.rail__avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 8px;
}
.rail__avatar--on {
  filter: brightness(1.1);
}
.rail__avatar-state {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 2px solid var(--surf-rail);
}
</style>

<!-- Teleported menu styles must be global (not scoped to the rail subtree). -->
<style>
.rail-menu__backdrop {
  position: fixed;
  inset: 0;
  z-index: 998;
}
.rail-menu {
  position: fixed;
  left: 54px;
  bottom: 14px;
  z-index: 999;
  width: 232px;
  padding: 10px;
  border-radius: 14px;
  background: var(--bg1);
  border: 1px solid var(--border);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55);
}
.rail-menu__head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 2px 4px 6px;
}
.rail-menu__avatar {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  overflow: hidden;
}
.rail-menu__avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.rail-menu__name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.rail-menu__acct {
  font-size: 11px;
  color: var(--text3);
}
.rail-menu__sep {
  height: 1px;
  margin: 6px 2px;
  background: var(--border2);
}
.rail-menu__label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text3);
  padding: 0 4px 5px;
}
.rail-menu__states {
  display: flex;
  gap: 5px;
}
.rail-menu__state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 4px;
  border-radius: 9px;
  border: 1px solid var(--border2);
  background: transparent;
  color: var(--text2);
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.rail-menu__state--on {
  background: var(--acc-tint);
  border-color: var(--acc-border);
  color: var(--text);
}
.rail-menu__pip {
  width: 9px;
  height: 9px;
  border-radius: 50%;
}
.rail-menu__reasons {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.rail-menu__reason-search {
  margin-bottom: 2px;
}
.rail-menu__reason {
  text-align: left;
  padding: 7px 9px;
  border-radius: 7px;
  border: none;
  background: var(--bg2);
  color: var(--text);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.rail-menu__reason:hover {
  background: var(--acc-tint);
}
.rail-menu__reason--skip {
  color: var(--text3);
}
.rail-menu__skills {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding: 0 2px;
}
.rail-menu__skill {
  font-size: 10px;
  color: var(--acc);
  background: var(--acc-tint);
  border: 1px solid var(--acc-border);
  border-radius: 5px;
  padding: 1px 6px;
}

/* Conversation hover tooltip */
.rail-tip {
  position: fixed;
  left: 52px;
  z-index: 1000;
  width: 250px;
  max-height: 280px;
  overflow-y: auto;
  padding: 11px 13px;
  border-radius: 12px;
  background: var(--bg1);
  border: 1px solid var(--border);
  box-shadow: 0 16px 44px rgba(0, 0, 0, 0.5);
  pointer-events: none;
}
.rail-tip__name {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
}
.rail-tip__sub {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--text3);
  margin: 1px 0 7px;
}
.rail-tip__empty {
  font-size: 12px;
  color: var(--text3);
}
.rail-tip__lines {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.rail-tip__line {
  font-size: 12px;
  line-height: 1.4;
}
.rail-tip__who {
  font-weight: 600;
  color: var(--text2);
}
.rail-tip__who--agent {
  color: var(--acc);
}
.rail-tip__body {
  color: var(--text2);
}
</style>
