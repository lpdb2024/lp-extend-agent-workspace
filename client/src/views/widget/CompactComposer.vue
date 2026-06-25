<script setup lang="ts">
import { ref, nextTick, onMounted, onBeforeUnmount } from 'vue';
import Icon from '../../components/Icon.vue';
import type { WorkspaceStore } from '../../composables/workspace-store';

const props = defineProps<{ w: WorkspaceStore }>();
const emit = defineEmits<{ (e: 'open-forms'): void }>();
const w = props.w;
const aiOpen = ref(false);
const listOpen = ref(false);
const liveOpen = ref(false);

function closePopups() {
  aiOpen.value = false;
  listOpen.value = false;
  liveOpen.value = false;
}
onMounted(() => window.addEventListener('click', closePopups));
onBeforeUnmount(() => window.removeEventListener('click', closePopups));

function onEnter(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    w.send();
  }
}

/** Wrap the current selection (or insert at cursor) with markdown markers. */
function wrap(before: string, after = before) {
  const el = w.composerEl.value;
  const text = w.draft.value;
  const start = el?.selectionStart ?? text.length;
  const end = el?.selectionEnd ?? text.length;
  const sel = text.slice(start, end) || 'text';
  w.draft.value = text.slice(0, start) + before + sel + after + text.slice(end);
  void nextTick(() => {
    el?.focus();
    const caret = start + before.length;
    el?.setSelectionRange(caret, caret + sel.length);
  });
}

/** Prefix each selected line (or the current line) for lists. */
function listify(kind: 'ordered' | 'unordered') {
  listOpen.value = false;
  const el = w.composerEl.value;
  const text = w.draft.value;
  const start = el?.selectionStart ?? text.length;
  const end = el?.selectionEnd ?? text.length;
  // Expand to full lines.
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = text.indexOf('\n', end) === -1 ? text.length : text.indexOf('\n', end);
  const block = text.slice(lineStart, lineEnd) || 'item';
  const lines = block.split('\n');
  const out = lines
    .map((l, i) => (kind === 'ordered' ? `${i + 1}. ${l}` : `- ${l}`))
    .join('\n');
  w.draft.value = text.slice(0, lineStart) + out + text.slice(lineEnd);
  void nextTick(() => el?.focus());
}

function startLive(mode: 'cobrowse' | 'video-call' | 'voice-call') {
  liveOpen.value = false;
  w.startCobrowse(mode);
}
</script>

<template>
  <div class="cp" :class="{ 'cp--disabled': !w.active.value }">
    <!-- Hotkey quick-content menu -->
    <Transition name="wg-fade">
      <div v-if="w.quickMenu.value" class="cp__quick" @click.stop>
        <div class="cp__quick-head">
          Quick content · prefix “{{ w.quickMenu.value.prefix }}”
        </div>
        <button
          v-for="it in w.quickMenu.value.items"
          :key="it.id"
          class="cp__quick-item"
          @click="w.insertQuick(it)"
        >
          <span class="cp__quick-key">{{ it.hotkey?.suffix }}</span>
          <span class="cp__quick-title">{{ it.title }}</span>
        </button>
      </div>
    </Transition>

    <input
      :ref="(el) => (w.fileInput.value = el as HTMLInputElement)"
      type="file"
      :accept="w.FILE_ACCEPT"
      class="hidden"
      @change="w.onFile"
    />

    <div class="cp__box">
      <!-- Formatting toolbar -->
      <div class="cp__format">
        <button class="wg-btn cp__btn" title="Bold" @click="wrap('**')">
          <Icon name="bold" :size="14" />
        </button>
        <button class="wg-btn cp__btn" title="Italic" @click="wrap('*')">
          <Icon name="italic" :size="14" />
        </button>
        <!-- List popup (numbered / bulleted) -->
        <div class="cp__pop">
          <button class="wg-btn cp__btn" title="List" @click.stop="listOpen = !listOpen">
            <Icon name="list" :size="14" />
          </button>
          <Transition name="wg-fade">
            <div v-if="listOpen" class="wg-menu cp__pop-menu" @click.stop>
              <button class="wg-menu-item" @click="listify('unordered')">
                <Icon name="list" :size="14" /> Bulleted
              </button>
              <button class="wg-menu-item" @click="listify('ordered')">
                <Icon name="list-ordered" :size="14" /> Numbered
              </button>
            </div>
          </Transition>
        </div>
      </div>

      <textarea
        :ref="(el) => (w.composerEl.value = el as HTMLTextAreaElement)"
        v-model="w.draft.value"
        rows="1"
        class="cp__input"
        placeholder="Send a message…"
        :disabled="!w.active.value"
        @keydown="w.onComposerKey"
        @keydown.enter="onEnter"
      />
      <div class="cp__actions">
        <!-- File -->
        <button class="wg-btn cp__btn" title="Attach file" @click="w.fileInput.value?.click()">
          <Icon name="paperclip" :size="15" />
        </button>

        <!-- Cobrowse / video / voice popup -->
        <div class="cp__pop">
          <button class="wg-btn cp__btn" title="Cobrowse & calls" @click.stop="liveOpen = !liveOpen">
            <Icon name="monitor" :size="15" />
          </button>
          <Transition name="wg-fade">
            <div v-if="liveOpen" class="wg-menu cp__live-menu" @click.stop>
              <button class="wg-menu-item" @click="startLive('cobrowse')">
                <Icon name="monitor" :size="14" /> Cobrowse
              </button>
              <button class="wg-menu-item" @click="startLive('video-call')">
                <Icon name="video" :size="14" /> Video call
              </button>
              <button class="wg-menu-item" @click="startLive('voice-call')">
                <Icon name="phone" :size="14" /> Voice call
              </button>
            </div>
          </Transition>
        </div>

        <!-- Secure form -->
        <button class="wg-btn cp__btn" title="Send secure form" @click="emit('open-forms')">
          <Icon name="lock" :size="15" />
        </button>

        <!-- AI dropdown (rewrite + translate) -->
        <div class="cp__ai">
          <button class="wg-btn cp__btn" title="AI" @click.stop="aiOpen = !aiOpen">
            <Icon name="sparkles" :size="15" />
          </button>
          <Transition name="wg-fade">
            <div v-if="aiOpen" class="wg-menu cp__ai-menu" @click.stop>
              <button
                class="wg-menu-item"
                :disabled="w.rewriting.value || !w.draft.value.trim()"
                @click="w.smartRewrite(); aiOpen = false"
              >
                <Icon name="sparkles" :size="14" />
                {{ w.rewriting.value ? 'Rewriting…' : 'Rewrite' }}
              </button>
              <button
                class="wg-menu-item"
                :class="w.translateActive.value ? 'wg-menu-item--on' : ''"
                @click="w.translateActive.value = !w.translateActive.value; aiOpen = false"
              >
                <Icon name="languages" :size="14" />
                {{ w.translateActive.value ? 'Translation on' : 'Translate' }}
              </button>
            </div>
          </Transition>
        </div>

        <div class="cp__spacer" />

        <!-- Send -->
        <button
          class="cp__send"
          :disabled="!w.draft.value.trim() || !w.active.value"
          @click="w.send()"
        >
          <Icon name="send" :size="15" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cp {
  flex-shrink: 0;
  padding: 8px;
  background: var(--surf-comp);
  border-top: 1px solid var(--border2);
  backdrop-filter: var(--blur-sm);
  position: relative;
}
.cp--disabled {
  opacity: 0.6;
  pointer-events: none;
}
.cp__box {
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surf-input);
  padding: 6px 6px 6px 10px;
}
.cp__input {
  width: 100%;
  max-height: 110px;
  resize: none;
  border: none;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  outline: none;
  padding: 4px 0;
}
.cp__input::placeholder {
  color: var(--text3);
}
.cp__format {
  display: flex;
  align-items: center;
  gap: 2px;
  padding-bottom: 4px;
  margin-bottom: 2px;
  border-bottom: 1px solid var(--border2);
}
.cp__actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-top: 2px;
}
.cp__btn {
  width: 28px;
  height: 28px;
}
.cp__ai,
.cp__pop {
  position: relative;
}
.cp__ai-menu,
.cp__pop-menu,
.cp__live-menu {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  z-index: 40;
}
.cp__spacer {
  flex: 1;
}
.cp__send {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 30px;
  border: none;
  border-radius: 9px;
  background: var(--acc-grad);
  color: #fff;
  cursor: pointer;
  transition: opacity 0.12s;
}
.cp__send:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
/* Quick menu */
.cp__quick {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: calc(100% - 4px);
  max-height: 240px;
  overflow-y: auto;
  background: var(--bg1);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
  z-index: 40;
  padding: 5px;
}
.cp__quick-head {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text3);
  padding: 5px 7px;
}
.cp__quick-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 7px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}
.cp__quick-item:hover {
  background: var(--acc-tint);
}
.cp__quick-key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  background: var(--acc-tint);
  border: 1px solid var(--acc-border);
  color: var(--acc);
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
}
.wg-menu-item--on {
  color: var(--acc);
}
</style>
