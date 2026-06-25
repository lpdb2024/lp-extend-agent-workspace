<script setup lang="ts">
import { computed, provide, reactive } from 'vue';
import RichContentElement from './RichContentElement.vue';

const props = defineProps<{ content: Record<string, any> }>();
const emit = defineEmits<{ action: [action: Record<string, any>] }>();

const checkedItems = reactive(new Map<Record<string, any>, string>());
provide('rc-checked-items', checkedItems);

const elements = computed(() => props.content.elements ?? []);
const type = computed(() => props.content.type as string);

const quickReplies = computed(() => {
  const qr = props.content.quickReplies;
  if (!qr) return [];
  if (Array.isArray(qr)) return qr;
  if (Array.isArray(qr.replies)) return qr.replies;
  return [];
});

const hWidths = computed(() => {
  if (type.value !== 'horizontal' || !elements.value.length) return [];
  if (props.content.percentages?.length === elements.value.length)
    return props.content.percentages.map((p: number) => `${p}%`);
  const w = 100 / elements.value.length;
  return elements.value.map(() => `${w}%`);
});

function onAction(action: Record<string, any>) { emit('action', action); }
</script>

<template>
  <div class="rc-root">
    <!-- vertical -->
    <div v-if="type === 'vertical'" class="rc-card">
      <RichContentElement v-for="(el, i) in elements" :key="i" :element="el" :depth="0" @action="onAction" />
    </div>

    <!-- horizontal -->
    <div v-else-if="type === 'horizontal'" class="rc-horizontal">
      <div v-for="(el, i) in elements" :key="i" class="rc-horizontal__item" :style="{ width: hWidths[i] }">
        <RichContentElement :element="el" :depth="0" @action="onAction" />
      </div>
    </div>

    <!-- carousel -->
    <div v-else-if="type === 'carousel'" class="rc-carousel">
      <div class="rc-carousel__track" :style="{ gap: `${content.padding || 8}px` }">
        <div v-for="(el, i) in elements" :key="i" class="rc-carousel__item">
          <RichContentElement :element="el" :depth="0" @action="onAction" />
        </div>
      </div>
    </div>

    <!-- quick replies -->
    <div v-if="quickReplies.length" class="rc-qr">
      <button v-for="(qr, i) in quickReplies" :key="i" class="rc-qr__btn" :title="qr.tooltip" @click="onAction({ type: 'publishText', text: qr.title })">
        {{ qr.title }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.rc-root { width: 100%; max-width: 100%; display: flex; flex-direction: column; align-items: center; }

.rc-card {
  display: flex; flex-direction: column; gap: 4px;
  background: var(--bg1); border: 1px solid var(--border);
  border-radius: 12px; padding: 12px 14px;
  box-shadow: var(--shadow);
}

.rc-horizontal { display: flex; gap: 6px; }
.rc-horizontal__item { flex-shrink: 0; min-width: 0; }

.rc-carousel { overflow-x: auto; -webkit-overflow-scrolling: touch; width: 100%; }
.rc-carousel__track { display: flex; padding: 4px 0; width: max-content; margin: 0 auto; }
.rc-carousel__item {
  flex-shrink: 0; min-width: 160px; max-width: 240px;
  background: var(--bg1); border: 1px solid var(--border); border-radius: 10px; padding: 10px;
}

.rc-qr { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.rc-qr__btn {
  padding: 5px 12px; border-radius: 16px; font-size: 12px;
  border: 1px solid var(--acc-border); background: var(--acc-tint); color: var(--acc);
  cursor: pointer; transition: all 0.1s;
}
.rc-qr__btn:hover { background: var(--acc); color: #fff; }
</style>
