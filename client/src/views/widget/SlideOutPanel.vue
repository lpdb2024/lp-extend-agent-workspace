<script setup lang="ts">
import { ref, watch } from 'vue';
import Icon from '../../components/Icon.vue';
import type { PanelTab } from '../../composables/useWorkspace';
import type { WorkspaceStore } from '../../composables/workspace-store';

const props = defineProps<{ w: WorkspaceStore; tab: PanelTab }>();
const emit = defineEmits<{ (e: 'close'): void }>();
const w = props.w;

const tab = ref<PanelTab>(props.tab);
watch(
  () => props.tab,
  (t) => (tab.value = t),
);

const tabs: { key: PanelTab; label: string; icon: string }[] = [
  { key: 'sdes', label: 'Customer', icon: 'user' },
  { key: 'notes', label: 'Notes', icon: 'copy' },
  { key: 'pdc', label: 'Canned', icon: 'chat' },
  { key: 'forms', label: 'Forms', icon: 'lock' },
  { key: 'pages', label: 'Pages', icon: 'monitor' },
  { key: 'cobrowse', label: 'Live', icon: 'video' },
];
</script>

<template>
  <div class="pn">
    <!-- Header -->
    <div class="pn__head">
      <div class="pn__tabs">
        <button
          v-for="t in tabs"
          :key="t.key"
          class="pn__tab"
          :class="{ 'pn__tab--on': tab === t.key }"
          :title="t.label"
          @click="tab = t.key"
        >
          <Icon :name="t.icon" :size="15" />
          <span v-if="t.key === 'notes' && w.hasNotes.value" class="pn__dot" />
        </button>
      </div>
      <button class="wg-btn" @click="emit('close')"><Icon name="x" :size="15" /></button>
    </div>

    <div class="pn__body">
      <!-- Customer / SDEs -->
      <div v-if="tab === 'sdes'" class="pn__scroll">
        <div v-if="w.customerLoading.value" class="pn__loading">Loading…</div>
        <template v-else>
          <section
            v-for="sec in [...w.customerSections.value, ...w.sdeSections.value]"
            :key="sec.title"
            class="pn__sec"
          >
            <div class="pn__sec-title">{{ sec.title }}</div>
            <div v-for="row in sec.rows" :key="row.label" class="pn__row">
              <span class="pn__row-k">{{ row.label }}</span>
              <span class="pn__row-v">{{ row.value }}</span>
            </div>
          </section>
          <div
            v-if="!w.customerSections.value.length && !w.sdeSections.value.length"
            class="pn__empty"
          >
            No customer data.
          </div>
        </template>
      </div>

      <!-- Notes -->
      <div v-else-if="tab === 'notes'" class="pn__scroll">
        <textarea
          v-model="w.noteDraft.value"
          class="pn__note"
          placeholder="Add a private note…"
        />
        <button class="wg-cta pn__note-save" :disabled="w.savingNote.value" @click="w.saveNote()">
          {{ w.savingNote.value ? 'Saving…' : 'Save note' }}
        </button>
        <div class="pn__note-list">
          <div v-for="n in w.notes.value" :key="n.noteId" class="pn__note-item">
            <div class="pn__note-head">
              <span class="pn__note-author">{{ n.name }}</span>
              <span v-if="n.isAutoSummary" class="pn__note-auto">Auto</span>
            </div>
            <div class="pn__note-body">{{ n.noteContent }}</div>
          </div>
        </div>
      </div>

      <!-- Canned -->
      <div v-else-if="tab === 'pdc'" class="pn__scroll">
        <input v-model="w.pdcSearch.value" class="wg-input pn__search" placeholder="Search canned…" />
        <div v-if="w.pdcLoading.value" class="pn__loading">Loading…</div>
        <div v-else-if="!w.pdcFiltered.value.length" class="pn__empty">No canned responses.</div>
        <div v-for="cat in w.pdcFiltered.value" :key="cat.id" class="pn__cat">
          <div class="pn__cat-title">{{ cat.name }} ({{ cat.items.length }})</div>
          <button
            v-for="p in cat.items"
            :key="p.id"
            class="pn__canned"
            @click="w.usePdc(p)"
          >
            <div class="pn__canned-top">
              <span class="pn__canned-title">{{ p.title }}</span>
              <span v-if="p.hotkey?.prefix || p.hotkey?.suffix" class="pn__canned-key">
                {{ p.hotkey?.prefix }}→{{ p.hotkey?.suffix }}
              </span>
            </div>
            <div v-if="p.text" class="pn__canned-text">{{ p.text }}</div>
          </button>
        </div>
      </div>

      <!-- Forms -->
      <div v-else-if="tab === 'forms'" class="pn__scroll">
        <div v-if="w.formsLoading.value" class="pn__loading">Loading…</div>
        <div v-else-if="!w.forms.value.length" class="pn__empty">
          No secure forms configured for this skill.
        </div>
        <div v-for="f in w.forms.value" :key="f.id" class="pn__form" @click="w.sendForm(f)">
          <div class="pn__form-top">
            <span class="pn__form-name">{{ f.name }}</span>
            <button class="th-send" :disabled="w.sendingForm.value">
              <Icon name="lock" :size="12" /> Send
            </button>
          </div>
          <div class="pn__form-fields">
            <span v-for="field in f.json" :key="field.id" class="pn__form-field">
              {{ field.name }}<span v-if="field.masked"> · masked</span>
            </span>
          </div>
        </div>
      </div>

      <!-- Pages -->
      <div v-else-if="tab === 'pages'" class="pn__scroll">
        <div v-if="w.pagesLoading.value" class="pn__loading">Loading…</div>
        <div v-else-if="!w.pages.value.length" class="pn__empty">No page-view history.</div>
        <ol v-else class="pn__pages">
          <li v-for="(p, i) in w.pages.value" :key="i" class="pn__page">
            <span class="pn__page-dot" />
            <a :href="p.page" target="_blank" rel="noopener" class="pn__page-title">
              {{ p.title || w.hostOf(p.page) }}
            </a>
            <div class="pn__page-host">{{ w.hostOf(p.page) }}</div>
            <div class="pn__page-time">{{ w.pageTime(p.visitTime) }}</div>
          </li>
        </ol>
      </div>

      <!-- Cobrowse / calls -->
      <div v-else-if="tab === 'cobrowse'" class="pn__cobrowse">
        <template v-if="w.activeCobrowse.value">
          <div class="pn__cb-head">
            <div class="pn__cb-status">
              <span
                class="pn__cb-dot"
                :class="{
                  'pn__cb-dot--on': w.activeCobrowse.value.phase === 'active',
                  'pn__cb-dot--wait': ['connecting', 'inviting', 'awaiting-accept'].includes(
                    w.activeCobrowse.value.phase,
                  ),
                  'pn__cb-dot--err': w.activeCobrowse.value.phase === 'error',
                }"
              />
              <div>
                <div class="pn__cb-mode">{{ w.cobrowseModeLabel(w.activeCobrowse.value.mode) }}</div>
                <div class="pn__cb-phase">{{ w.cobrowsePhaseLabel(w.activeCobrowse.value.phase) }}</div>
              </div>
            </div>
            <button class="th-send th-send--ghost" @click="w.stopCobrowse(w.activeId.value!)">
              <Icon name="ban" :size="12" /> End
            </button>
          </div>

          <div
            v-if="w.activeCobrowse.value.phase === 'active' && w.activeCobrowse.value.roomUrl"
            class="pn__cb-frame"
          >
            <iframe
              :src="w.activeCobrowse.value.roomUrl"
              class="pn__cb-iframe"
              allow="camera; microphone; display-capture; clipboard-read; clipboard-write"
            />
            <a
              :href="w.activeCobrowse.value.roomUrl"
              target="_blank"
              rel="noopener"
              class="pn__cb-pop"
              title="Pop out"
            >
              <Icon name="monitor" :size="13" /> Pop out
            </a>
          </div>
          <div v-else class="pn__cb-wait">
            <div v-if="w.activeCobrowse.value.phase !== 'error'" class="pn__cb-spin" />
            <Icon v-else name="ban" :size="32" class="pn__cb-err-icon" />
            <div class="pn__cb-wait-title">
              {{ w.cobrowsePhaseLabel(w.activeCobrowse.value.phase) }}
            </div>
            <p v-if="w.activeCobrowse.value.phase === 'awaiting-accept'" class="pn__cb-wait-sub">
              The customer received an invitation in their chat. It opens here once they accept.
            </p>
            <p v-if="w.activeCobrowse.value.error" class="pn__cb-err">
              {{ w.activeCobrowse.value.error }}
            </p>
          </div>
        </template>

        <div v-else class="pn__cb-start">
          <Icon name="monitor" :size="34" style="color: var(--text3)" />
          <div class="pn__cb-start-title">Start a live session</div>
          <div class="pn__cb-start-btns">
            <button class="wg-cta" @click="w.startCobrowse('cobrowse')">
              <Icon name="monitor" :size="14" /> Cobrowse
            </button>
            <button class="wg-cta" @click="w.startCobrowse('video-call')">
              <Icon name="video" :size="14" /> Video
            </button>
            <button class="wg-cta" @click="w.startCobrowse('voice-call')">
              <Icon name="phone" :size="14" /> Voice
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pn {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--surf-panel);
  backdrop-filter: var(--blur-md);
}
.pn__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 50px;
  padding: 0 8px;
  border-bottom: 1px solid var(--border2);
  background: var(--surf-header);
}
.pn__tabs {
  display: flex;
  gap: 2px;
}
.pn__tab {
  position: relative;
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text2);
  cursor: pointer;
}
.pn__tab:hover {
  background: var(--grp-btn-bg);
  color: var(--text);
}
.pn__tab--on {
  background: var(--acc-tint);
  color: var(--acc);
}
.pn__dot {
  position: absolute;
  top: 5px;
  right: 6px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--acc2);
}
.pn__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.pn__scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
}
.pn__loading {
  font-size: 13px;
  color: var(--text3);
  animation: pulse 1.5s infinite;
}
.pn__empty {
  font-size: 13px;
  color: var(--text3);
  padding: 8px 0;
}
/* Customer */
.pn__sec {
  margin-bottom: 14px;
}
.pn__sec-title {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--acc);
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border2);
  margin-bottom: 5px;
}
.pn__row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 3px 2px;
}
.pn__row-k {
  font-size: 11px;
  color: var(--text3);
  flex-shrink: 0;
}
.pn__row-v {
  font-size: 12px;
  color: var(--text);
  text-align: right;
  word-break: break-word;
}
/* Notes */
.pn__note {
  width: 100%;
  min-height: 90px;
  resize: vertical;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--surf-input);
  color: var(--text);
  font: inherit;
  font-size: 13px;
  outline: none;
}
.pn__note-save {
  width: 100%;
  margin-top: 8px;
}
.pn__note-list {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pn__note-item {
  padding: 9px 11px;
  border-radius: 9px;
  background: var(--bg1);
  border: 1px solid var(--border2);
}
.pn__note-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 3px;
}
.pn__note-author {
  font-size: 11px;
  font-weight: 600;
  color: var(--text2);
}
.pn__note-auto {
  font-size: 9px;
  font-weight: 700;
  color: var(--acc);
  background: var(--acc-tint);
  border-radius: 4px;
  padding: 0 5px;
}
.pn__note-body {
  font-size: 12px;
  color: var(--text);
  white-space: pre-wrap;
  line-height: 1.5;
}
/* Canned */
.pn__search {
  margin-bottom: 10px;
}
.pn__cat {
  margin-bottom: 12px;
}
.pn__cat-title {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text3);
  margin-bottom: 6px;
}
.pn__canned {
  display: block;
  width: 100%;
  text-align: left;
  padding: 9px 11px;
  margin-bottom: 6px;
  border-radius: 9px;
  background: var(--bg1);
  border: 1px solid var(--border2);
  cursor: pointer;
}
.pn__canned:hover {
  border-color: var(--acc-border);
}
.pn__canned-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.pn__canned-title {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--text2);
}
.pn__canned-key {
  font-family: ui-monospace, monospace;
  font-size: 10px;
  color: var(--acc);
  background: var(--acc-tint);
  border-radius: 4px;
  padding: 1px 5px;
}
.pn__canned-text {
  font-size: 11px;
  color: var(--text3);
  margin-top: 3px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
/* Forms */
.pn__form {
  padding: 11px;
  margin-bottom: 8px;
  border-radius: 10px;
  background: var(--bg1);
  border: 1px solid var(--border);
  cursor: pointer;
}
.pn__form-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.pn__form-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
}
.th-send {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  font-weight: 600;
  padding: 4px 9px;
  border-radius: 7px;
  color: #fff;
  background: var(--acc-grad);
  border: none;
  cursor: pointer;
}
.th-send--ghost {
  background: rgba(239, 68, 68, 0.15);
  color: #f87171;
}
.pn__form-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 7px;
}
.pn__form-field {
  font-size: 10px;
  color: var(--text3);
  background: var(--badge-bg);
  border-radius: 5px;
  padding: 1px 6px;
}
/* Pages */
.pn__pages {
  margin-left: 6px;
  border-left: 1px solid var(--border);
  list-style: none;
  padding: 0;
}
.pn__page {
  position: relative;
  margin-left: 14px;
  margin-bottom: 12px;
}
.pn__page-dot {
  position: absolute;
  left: -19px;
  top: 5px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--acc);
}
.pn__page-title {
  font-size: 13px;
  color: var(--text2);
  word-break: break-word;
}
.pn__page-host {
  font-size: 11px;
  color: var(--text3);
  word-break: break-all;
}
.pn__page-time {
  font-size: 11px;
  color: var(--text3);
  margin-top: 1px;
}
/* Cobrowse */
.pn__cobrowse {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.pn__cb-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border2);
}
.pn__cb-status {
  display: flex;
  align-items: center;
  gap: 9px;
}
.pn__cb-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text3);
}
.pn__cb-dot--on {
  background: #34d399;
}
.pn__cb-dot--wait {
  background: #fbbf24;
}
.pn__cb-dot--err {
  background: #f87171;
}
.pn__cb-mode {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.pn__cb-phase {
  font-size: 11px;
  color: var(--text3);
}
.pn__cb-frame {
  flex: 1;
  min-height: 0;
  position: relative;
}
.pn__cb-iframe {
  width: 100%;
  height: 100%;
  border: 0;
  background: #fff;
}
.pn__cb-pop {
  position: absolute;
  top: 8px;
  right: 8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 7px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  backdrop-filter: blur(8px);
}
.pn__cb-wait {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 24px;
  gap: 10px;
}
.pn__cb-spin {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 3px solid var(--acc-border);
  border-top-color: var(--acc);
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.pn__cb-err-icon {
  color: #f87171;
}
.pn__cb-wait-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.pn__cb-wait-sub {
  font-size: 12px;
  color: var(--text3);
  line-height: 1.5;
  max-width: 260px;
}
.pn__cb-err {
  font-size: 12px;
  color: #fca5a5;
}
.pn__cb-start {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  text-align: center;
}
.pn__cb-start-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.pn__cb-start-btns {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 180px;
}
.pn__cb-start-btns .wg-cta {
  width: 100%;
}
</style>
