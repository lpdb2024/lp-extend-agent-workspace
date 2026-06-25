<script setup lang="ts">
import Icon from '../../components/Icon.vue';
import type { WorkspaceStore } from '../../composables/workspace-store';

const props = defineProps<{ w: WorkspaceStore }>();
const emit = defineEmits<{ (e: 'close'): void }>();
const w = props.w;

function pick(id: string) {
  w.selectConversation(id);
  emit('close');
}
</script>

<template>
  <div class="sw">
    <div class="sw__head">
      <div class="sw__title">Conversations <span class="sw__count">{{ w.counts.value.all }}</span></div>
      <button class="wg-btn" @click="emit('close')"><Icon name="x" :size="15" /></button>
    </div>

    <!-- Search -->
    <div class="sw__search">
      <Icon name="search" :size="13" style="color: var(--text3)" />
      <input v-model="w.search.value" class="sw__search-input" placeholder="Search…" />
    </div>

    <!-- Status filter chips -->
    <div class="sw__filters">
      <button
        v-for="f in w.filters"
        :key="f.key"
        class="sw__chip"
        :class="{ 'sw__chip--on': w.filter.value === f.key }"
        @click="w.toggleFilter(f.key)"
      >
        <Icon v-if="f.key !== 'all'" :name="w.statusMeta(f.key as any).icon" :size="11" />
        {{ f.label }}
        <span class="sw__chip-n">{{ w.counts.value[f.key] }}</span>
      </button>
    </div>

    <!-- List -->
    <div class="sw__list">
      <div v-if="!w.visibleConversations.value.length" class="sw__empty">No conversations.</div>
      <button
        v-for="c in w.visibleConversations.value"
        :key="c.conversationId"
        class="sw__row"
        :class="{ 'sw__row--on': c.conversationId === w.activeId.value }"
        @click="pick(c.conversationId)"
        @contextmenu="w.openCtxMenu($event, c.conversationId)"
      >
        <div class="sw__avatar" :style="w.avatarStyle(c.conversationId)">
          {{ w.initials(c.consumerName) }}
        </div>
        <div class="sw__body">
          <div class="sw__row-top">
            <span class="sw__name">{{ c.consumerName }}</span>
            <span class="sw__time">{{ w.relTime(c.updateTime) }}</span>
          </div>
          <div class="sw__preview">{{ c.lastMessage || '—' }}</div>
          <div class="sw__tags">
            <span class="sw__status" :class="`sw__status--${w.liveStatus(c)}`">
              <Icon :name="w.statusMeta(w.liveStatus(c)).icon" :size="10" />
              {{ w.statusLabel(c) }}
            </span>
            <span v-if="c.skillName" class="sw__skill">{{ c.skillName }}</span>
          </div>
        </div>
      </button>
    </div>
  </div>
</template>

<style scoped>
.sw {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--surf-panel);
  backdrop-filter: var(--blur-md);
}
.sw__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 50px;
  padding: 0 8px 0 14px;
  border-bottom: 1px solid var(--border2);
  background: var(--surf-header);
}
.sw__title {
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
}
.sw__count {
  font-size: 11px;
  font-weight: 600;
  color: var(--text3);
  background: var(--badge-bg);
  border-radius: 999px;
  padding: 1px 7px;
  margin-left: 4px;
}
.sw__search {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 9px 10px 4px;
  padding: 7px 10px;
  border-radius: 9px;
  background: var(--surf-input);
  border: 1px solid var(--border2);
}
.sw__search-input {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  outline: none;
}
.sw__search-input::placeholder {
  color: var(--text3);
}
.sw__filters {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding: 4px 10px 8px;
}
.sw__chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 9px;
  border-radius: 8px;
  border: 1px solid var(--border2);
  background: transparent;
  color: var(--text2);
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.sw__chip--on {
  background: var(--acc-tint);
  border-color: var(--acc-border);
  color: var(--acc);
}
.sw__chip-n {
  opacity: 0.7;
}
.sw__list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 6px 10px;
}
.sw__empty {
  padding: 20px;
  text-align: center;
  font-size: 13px;
  color: var(--text3);
}
.sw__row {
  display: flex;
  gap: 9px;
  width: 100%;
  padding: 9px 8px;
  border: 1px solid transparent;
  border-radius: 11px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background 0.1s;
}
.sw__row:hover {
  background: var(--acc-tint);
}
.sw__row--on {
  background: var(--acc-tint);
  border-color: var(--acc-border);
}
.sw__avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}
.sw__body {
  min-width: 0;
  flex: 1;
}
.sw__row-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
}
.sw__name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sw__time {
  font-size: 10px;
  color: var(--text3);
  flex-shrink: 0;
}
.sw__preview {
  font-size: 11.5px;
  color: var(--text3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin: 1px 0 4px;
}
.sw__tags {
  display: flex;
  align-items: center;
  gap: 5px;
}
.sw__status {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--badge-bg);
  color: var(--text2);
}
.sw__status--overdue {
  color: #fb7185;
}
.sw__status--urgent {
  color: #fbbf24;
}
.sw__status--active {
  color: #34d399;
}
.sw__skill {
  font-size: 10px;
  color: var(--acc);
  background: var(--acc-tint);
  border: 1px solid var(--acc-border);
  border-radius: 5px;
  padding: 1px 6px;
}
</style>
