<script setup lang="ts">
import { ref } from 'vue';
import Icon from '../../components/Icon.vue';
import { useWorkspace, type PanelTab } from '../../composables/useWorkspace';
import { type Me } from '../../lib/api';
import WidgetRail from './WidgetRail.vue';
import WidgetHeader from './WidgetHeader.vue';
import CompactThread from './CompactThread.vue';
import CompactComposer from './CompactComposer.vue';
import ConvSwitcher from './ConvSwitcher.vue';
import SlideOutPanel from './SlideOutPanel.vue';

const props = defineProps<{ me: Me; theme?: 'dark' | 'light' }>();
const emit = defineEmits<{ (e: 'sign-out'): void; (e: 'toggle-theme'): void }>();

const w = useWorkspace(props.me, emit);

// Slide-over state (only one open at a time over the 400×700 surface).
const switcherOpen = ref(false);
const panelOpen = ref(false);
const panelTab = ref<PanelTab>('sdes');

function openPanel(tab: string) {
  panelTab.value = tab as PanelTab;
  panelOpen.value = true;
}
function openTransfer() {
  if (w.active.value) w.openTransferDialog(w.active.value.conversationId);
}
function openPrivate() {
  if (w.active.value) w.openPrivateModal(w.active.value.conversationId);
}
function openForms() {
  w.openFormPicker();
}

// When cobrowse/calls start, surface the panel on the Live tab.
function watchCobrowse() {
  if (w.activeCobrowse.value) {
    panelTab.value = 'cobrowse';
    panelOpen.value = true;
  }
}
</script>

<template>
  <div class="ww">
    <!-- Main surface -->
    <div class="ww__main">
      <WidgetRail :w="w" :theme="theme" @open-switcher="switcherOpen = true" />
      <div class="ww__chat">
        <WidgetHeader
          :w="w"
          @open-panel="openPanel"
          @open-transfer="openTransfer"
          @open-private="openPrivate"
          @open-forms="openForms"
        />
        <CompactThread :w="w" />
        <CompactComposer :w="w" @open-forms="openForms" />
      </div>
    </div>

    <!-- Conversation switcher slide-over -->
    <Transition name="wg-slide">
      <div v-if="switcherOpen" class="ww__over">
        <ConvSwitcher :w="w" @close="switcherOpen = false" />
      </div>
    </Transition>

    <!-- Slide-out detail panel -->
    <Transition name="wg-slide" @after-enter="watchCobrowse">
      <div v-if="panelOpen" class="ww__over">
        <SlideOutPanel :w="w" :tab="panelTab" @close="panelOpen = false" />
      </div>
    </Transition>

    <!-- Transfer overlay -->
    <Transition name="wg-fade">
      <div v-if="w.transferDialog.value" class="ww__modal" @click.self="w.transferDialog.value = null">
        <div class="ww__sheet">
          <div class="ww__sheet-head">
            <span>Transfer conversation</span>
            <button class="wg-btn" @click="w.transferDialog.value = null">
              <Icon name="x" :size="15" />
            </button>
          </div>
          <div class="ww__tabs">
            <button
              v-for="t in (['skill', 'agent', 'manager'] as const)"
              :key="t"
              class="ww__tab"
              :class="{ 'ww__tab--on': w.transferTab.value === t }"
              @click="w.transferTab.value = t"
            >
              {{ t === 'skill' ? 'Skills' : t === 'agent' ? 'Agents' : 'Managers' }}
            </button>
          </div>
          <input v-model="w.transferSearch.value" class="wg-input ww__sheet-search" placeholder="Search…" />
          <div class="ww__sheet-list">
            <template v-if="w.transferTab.value === 'skill'">
              <button
                v-for="s in w.filteredSkills.value"
                :key="s.id"
                class="ww__opt"
                :class="{ 'ww__opt--on': w.transferSelected.value === s.id }"
                @click="w.transferSelected.value = s.id"
              >
                {{ s.name }}
              </button>
            </template>
            <template v-else>
              <button
                v-for="a in (w.transferTab.value === 'agent' ? w.filteredAgents.value : w.filteredManagers.value)"
                :key="a.id"
                class="ww__opt"
                :class="{ 'ww__opt--on': w.transferSelected.value === a.id }"
                @click="w.transferSelected.value = a.id"
              >
                <span class="ww__status" :class="`ww__status--${a.status.toLowerCase()}`" />
                <!-- Person / bot icon (left of name) -->
                <Icon :name="a.isBot ? 'cpu' : 'user'" :size="13" class="ww__opt-type" />
                <span class="ww__opt-name">{{ a.displayName || a.loginName }}</span>
                <!-- Skill chip (right): 1 skill name, or count with tooltip -->
                <span
                  v-if="a.skills.length"
                  class="ww__opt-skill"
                  :title="a.skills.map((s) => s.name).join(', ')"
                >
                  {{ a.skills.length === 1 ? a.skills[0].name : `${a.skills.length} skills` }}
                </span>
              </button>
              <div
                v-if="!(w.transferTab.value === 'agent' ? w.filteredAgents.value : w.filteredManagers.value).length"
                class="ww__sheet-empty"
              >
                No {{ w.transferTab.value === 'agent' ? 'agents' : 'managers' }} found.
              </div>
            </template>
          </div>
          <button
            class="wg-cta ww__sheet-cta"
            :disabled="!w.transferSelected.value || w.transferring.value"
            @click="w.doTransfer()"
          >
            {{ w.transferring.value ? 'Transferring…' : 'Transfer' }}
          </button>
        </div>
      </div>
    </Transition>

    <!-- Private message overlay -->
    <Transition name="wg-fade">
      <div v-if="w.privateModal.value" class="ww__modal" @click.self="w.privateModal.value = null">
        <div class="ww__sheet">
          <div class="ww__sheet-head">
            <span>Private message</span>
            <button class="wg-btn" @click="w.privateModal.value = null">
              <Icon name="x" :size="15" />
            </button>
          </div>
          <textarea
            v-model="w.privateDraft.value"
            class="ww__private"
            placeholder="Visible to agents only…"
          />
          <button class="wg-cta ww__sheet-cta" :disabled="!w.privateDraft.value.trim()" @click="w.sendPrivate()">
            Send private
          </button>
        </div>
      </div>
    </Transition>

    <!-- Secure form picker overlay -->
    <Transition name="wg-fade">
      <div v-if="w.formPicker.value" class="ww__modal" @click.self="w.formPicker.value = false">
        <div class="ww__sheet">
          <div class="ww__sheet-head">
            <span>Send secure form</span>
            <button class="wg-btn" @click="w.formPicker.value = false">
              <Icon name="x" :size="15" />
            </button>
          </div>
          <div v-if="w.formsLoading.value" class="ww__sheet-empty">Loading…</div>
          <div v-else-if="!w.forms.value.length" class="ww__sheet-empty">
            No secure forms configured.
          </div>
          <div class="ww__sheet-list">
            <button
              v-for="f in w.forms.value"
              :key="f.id"
              class="ww__opt"
              :disabled="w.sendingForm.value"
              @click="w.sendForm(f)"
            >
              <Icon name="lock" :size="13" /> {{ f.name }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Secure form submission viewer -->
    <Transition name="wg-fade">
      <div v-if="w.formView.value" class="ww__modal" @click.self="w.formView.value = null">
        <div class="ww__sheet">
          <div class="ww__sheet-head">
            <span>{{ w.formView.value.title }}</span>
            <button class="wg-btn" @click="w.formView.value = null">
              <Icon name="x" :size="15" />
            </button>
          </div>
          <div class="ww__sheet-list">
            <template
              v-if="w.formView.value.result.data && typeof w.formView.value.result.data === 'object'"
            >
              <div
                v-for="(val, key) in (w.formView.value.result.data as Record<string, unknown>)"
                :key="key"
                class="ww__field"
              >
                <span class="ww__field-k">{{ key }}</span>
                <span class="ww__field-v">{{ val }}</span>
              </div>
            </template>
            <div class="ww__field">
              <span class="ww__field-k">Read token</span>
              <span class="ww__field-v" style="font-family: ui-monospace, monospace; font-size: 10px">
                {{ w.formView.value.result.readOtk }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Context menu (right-click on a conv row) -->
    <Transition name="wg-fade">
      <div
        v-if="w.ctxMenu.value"
        class="wg-menu ww__ctx"
        :style="{ left: w.ctxMenu.value.x + 'px', top: w.ctxMenu.value.y + 'px' }"
        @click.stop
      >
        <button class="wg-menu-item" @click="w.openTransferDialog(w.ctxMenu.value!.id)">
          <Icon name="transfer" :size="14" /> Transfer
        </button>
        <button class="wg-menu-item" @click="w.openPrivateModal(w.ctxMenu.value!.id)">
          <Icon name="lock" :size="14" /> Private message
        </button>
        <button class="wg-menu-item" @click="w.backToQueue(w.ctxMenu.value!.id)">
          <Icon name="undo" :size="14" /> Back to queue
        </button>
        <button class="wg-menu-item wg-menu-item--danger" @click="w.endConversation(w.ctxMenu.value!.id)">
          <Icon name="ban" :size="14" /> End conversation
        </button>
      </div>
    </Transition>

    <!-- Toast -->
    <Transition name="wg-fade">
      <div v-if="w.toast.value" class="ww__toast" :class="`ww__toast--${w.toast.value.kind}`">
        {{ w.toast.value.text }}
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.ww {
  position: relative;
  height: 100%;
  overflow: hidden;
}
.ww__main {
  height: 100%;
  display: flex;
}
.ww__chat {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--surf-thread);
  backdrop-filter: blur(24px);
}
.ww__over {
  position: absolute;
  inset: 0;
  z-index: 50;
}
/* Modals */
.ww__modal {
  position: absolute;
  inset: 0;
  z-index: 70;
  display: flex;
  align-items: flex-end;
  background: rgba(0, 0, 0, 0.4);
}
.ww__sheet {
  width: 100%;
  max-height: 80%;
  display: flex;
  flex-direction: column;
  padding: 14px;
  border-top-left-radius: 18px;
  border-top-right-radius: 18px;
  background: var(--bg1);
  border-top: 1px solid var(--border);
}
.ww__sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
  margin-bottom: 10px;
}
.ww__tabs {
  display: flex;
  gap: 3px;
  padding: 4px;
  border-radius: 9px;
  background: var(--surf-input);
  margin-bottom: 8px;
}
.ww__tab {
  flex: 1;
  padding: 6px 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text2);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.ww__tab--on {
  background: var(--acc-tint);
  color: var(--acc);
}
.ww__sheet-search {
  margin-bottom: 8px;
}
.ww__sheet-list {
  flex: 1;
  overflow-y: auto;
  min-height: 60px;
}
.ww__sheet-empty {
  font-size: 13px;
  color: var(--text3);
  padding: 16px 0;
  text-align: center;
}
.ww__opt {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 10px 11px;
  margin-bottom: 4px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.ww__opt:hover {
  background: var(--acc-tint);
}
.ww__opt--on {
  background: var(--acc-tint);
  border-color: var(--acc-border);
}
.ww__status {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--text3);
}
.ww__status--online {
  background: #22c55e;
}
.ww__status--occupied {
  background: #14b8a6;
}
.ww__status--away {
  background: #f59e0b;
}
.ww__status--back_soon {
  background: #3b82f6;
}
.ww__status--offline {
  background: #94a3b8;
}
.ww__opt-name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ww__opt-tag {
  font-size: 10px;
  font-weight: 600;
  color: var(--text2);
  background: var(--badge-bg);
  border-radius: 5px;
  padding: 1px 6px;
  flex-shrink: 0;
}
.ww__opt-skill {
  font-size: 10px;
  font-weight: 600;
  color: var(--acc);
  background: var(--acc-tint);
  border: 1px solid var(--acc-border);
  border-radius: 5px;
  padding: 1px 6px;
  flex-shrink: 0;
  max-width: 120px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ww__opt-type {
  flex-shrink: 0;
  color: var(--text3);
}
.ww__sheet-cta {
  width: 100%;
  margin-top: 8px;
}
.ww__private {
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
.ww__field {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 2px;
  border-bottom: 1px solid var(--border2);
}
.ww__field-k {
  font-size: 11px;
  color: var(--text3);
}
.ww__field-v {
  font-size: 12.5px;
  color: var(--text);
  text-align: right;
  word-break: break-word;
}
/* Context menu */
.ww__ctx {
  position: absolute;
  z-index: 80;
}
/* Toast */
.ww__toast {
  position: absolute;
  left: 50%;
  bottom: 70px;
  transform: translateX(-50%);
  z-index: 90;
  max-width: 86%;
  padding: 9px 14px;
  border-radius: 10px;
  font-size: 12.5px;
  font-weight: 500;
  color: #fff;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
}
.ww__toast--ok {
  background: #16a34a;
}
.ww__toast--err {
  background: #dc2626;
}
.ww__toast--info {
  background: var(--acc);
}
</style>
