<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import Icon from '../../components/Icon.vue';
import type { WorkspaceStore } from '../../composables/workspace-store';

const props = defineProps<{ w: WorkspaceStore }>();
const emit = defineEmits<{
  (e: 'open-panel', tab: string): void;
  (e: 'open-transfer'): void;
  (e: 'open-private'): void;
  (e: 'open-forms'): void;
}>();

const menuOpen = ref(false);
const w = props.w;

function act(fn: () => void) {
  menuOpen.value = false;
  fn();
}

// Click anywhere outside the menu closes it. The toggle button + the menu itself
// use @click.stop, so this only fires for outside clicks.
function closeMenu() {
  menuOpen.value = false;
}
onMounted(() => window.addEventListener('click', closeMenu));
onBeforeUnmount(() => window.removeEventListener('click', closeMenu));
</script>

<template>
  <header v-if="w.active.value" class="hd">
    <div class="hd__who">
      <div class="hd__avatar" :style="w.avatarStyle(w.active.value.conversationId)">
        {{ w.initials(w.active.value.consumerName) }}
      </div>
      <div class="hd__meta">
        <div class="hd__name-row">
          <img
            v-if="w.channelIcon(w.active.value.channel)"
            :src="w.channelIcon(w.active.value.channel)!"
            class="hd__channel"
          />
          <span class="hd__name">{{ w.active.value.consumerName }}</span>
        </div>
        <div class="hd__status" :class="`hd__status--${w.liveStatus(w.active.value)}`">
          {{ w.statusLabel(w.active.value) }}
        </div>
      </div>
    </div>

    <div class="hd__actions">
      <!-- Translate -->
      <button
        class="wg-btn"
        :class="w.translateActive.value ? 'wg-btn--on' : ''"
        title="Translation"
        @click="w.translateActive.value = !w.translateActive.value"
      >
        <Icon name="languages" :size="15" />
      </button>

      <!-- Transfer -->
      <button class="wg-btn" title="Transfer" @click="emit('open-transfer')">
        <Icon name="transfer" :size="15" />
      </button>

      <!-- Private message -->
      <button class="wg-btn" title="Private message" @click="emit('open-private')">
        <Icon name="lock" :size="15" />
      </button>

      <!-- Slide-out panel trigger -->
      <button class="wg-btn" title="Details" @click="emit('open-panel', 'sdes')">
        <Icon name="user" :size="15" />
        <span v-if="w.hasNotes.value" class="hd__notedot" />
      </button>

      <!-- Actions dropdown — kept on the far right -->
      <div class="hd__menu-wrap">
        <button class="wg-btn" title="Actions" @click.stop="menuOpen = !menuOpen">
          <Icon name="more-vertical" :size="15" />
        </button>
        <Transition name="wg-fade">
          <div v-if="menuOpen" class="wg-menu hd__menu" @click.stop>
            <button class="wg-menu-item" @click="act(() => w.startCobrowse('cobrowse'))">
              <Icon name="monitor" :size="14" /> Cobrowse
            </button>
            <button class="wg-menu-item" @click="act(() => w.startCobrowse('video-call'))">
              <Icon name="video" :size="14" /> Video call
            </button>
            <button class="wg-menu-item" @click="act(() => w.startCobrowse('voice-call'))">
              <Icon name="phone" :size="14" /> Voice call
            </button>
            <div class="wg-menu-sep" />
            <button class="wg-menu-item" @click="act(() => emit('open-forms'))">
              <Icon name="lock" :size="14" /> Send secure form
            </button>
            <button class="wg-menu-item" @click="act(() => emit('open-transfer'))">
              <Icon name="transfer" :size="14" /> Transfer
            </button>
            <button class="wg-menu-item" @click="act(() => emit('open-private'))">
              <Icon name="lock" :size="14" /> Private message
            </button>
            <div class="wg-menu-sep" />
            <button
              class="wg-menu-item"
              @click="act(() => w.backToQueue(w.active.value!.conversationId))"
            >
              <Icon name="undo" :size="14" /> Back to queue
            </button>
            <button
              class="wg-menu-item wg-menu-item--danger"
              @click="act(() => w.endConversation(w.active.value!.conversationId))"
            >
              <Icon name="ban" :size="14" /> End conversation
            </button>
          </div>
        </Transition>
      </div>
    </div>
  </header>
</template>

<style scoped>
.hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 50px;
  flex-shrink: 0;
  padding: 0 8px 0 12px;
  border-bottom: 1px solid var(--border2);
  background: var(--surf-header);
  backdrop-filter: var(--blur-sm);
}
.hd__who {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}
.hd__avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
}
.hd__meta {
  min-width: 0;
}
.hd__name-row {
  display: flex;
  align-items: center;
  gap: 5px;
}
.hd__channel {
  width: 13px;
  height: 13px;
  border-radius: 3px;
  object-fit: contain;
}
.hd__name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 150px;
}
.hd__status {
  font-size: 10.5px;
  color: var(--text2);
}
.hd__status--overdue {
  color: #fb7185;
}
.hd__status--urgent {
  color: #fbbf24;
}
.hd__status--active {
  color: #34d399;
}
.hd__actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
.hd__menu-wrap {
  position: relative;
}
.hd__menu {
  top: calc(100% + 4px);
  right: 0;
}
.hd__notedot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--acc2);
}
</style>
