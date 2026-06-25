<script setup lang="ts">
import { computed, ref, inject } from 'vue';

const props = withDefaults(defineProps<{
  element: Record<string, any>;
  depth?: number;
}>(), { depth: 0 });

const emit = defineEmits<{ action: [action: Record<string, any>] }>();

const datePickerValue = ref('');
const checkedItems = inject<Map<Record<string, any>, string>>('rc-checked-items', new Map());

const d = computed(() => props.depth ?? 0);
const el = computed(() => props.element);
const type = computed(() => el.value.type as string);

function getTextStyle(style?: Record<string, any>): Record<string, string> {
  if (!style) return {};
  const css: Record<string, string> = {};
  if (style.bold) css.fontWeight = 'bold';
  if (style.italic) css.fontStyle = 'italic';
  if (style.color) css.color = style.color;
  if (style['background-color']) css.backgroundColor = style['background-color'];
  if (style.size) {
    const sizes: Record<string, string> = { small: '11px', medium: '13px', large: '15px' };
    css.fontSize = sizes[style.size] ?? '13px';
  }
  return css;
}

function getButtonStyle(style?: Record<string, any>): Record<string, string> {
  if (!style) return {};
  const css: Record<string, string> = {};
  if (style['background-color']) css.backgroundColor = style['background-color'];
  if (style.color) css.color = style.color;
  if (style['border-color']) css.borderColor = style['border-color'];
  if (style['border-radius'] !== undefined) css.borderRadius = `${style['border-radius']}px`;
  return css;
}

function toggleCheckbox(element: Record<string, any>) {
  if (checkedItems.has(element)) {
    checkedItems.delete(element);
  } else {
    const a = element.click?.actions?.find((x: any) => x.type === 'checked');
    checkedItems.set(element, a?.publishText ?? element.text);
  }
}

function handleClick(element: Record<string, any>) {
  if (!element.click?.actions) return;
  for (const action of element.click.actions) {
    if (action.type === 'submitAsText') {
      const values = [...checkedItems.values()];
      if (values.length) emit('action', { type: 'publishText', text: values.join(', ') });
      return;
    }
    emit('action', action);
  }
}

function onNested(action: Record<string, any>) { emit('action', action); }

function hWidths(container: Record<string, any>): string[] {
  const els = container.elements ?? [];
  if (container.percentages?.length === els.length) return container.percentages.map((p: number) => `${p}%`);
  const w = 100 / (els.length || 1);
  return els.map(() => `${w}%`);
}
</script>

<template>
  <!-- text -->
  <div v-if="type === 'text'" class="rce-text" :style="getTextStyle(el.style)">{{ el.text }}</div>

  <!-- button / submitButton -->
  <button
    v-else-if="type === 'button' || type === 'submitButton'"
    class="rce-btn"
    :class="type === 'submitButton' ? 'rce-btn--submit' : ''"
    :style="getButtonStyle(el.style)"
    :title="el.tooltip"
    :disabled="el.disabled"
    @click="handleClick(el)"
  >{{ el.title }}</button>

  <!-- image -->
  <div v-else-if="type === 'image'" class="rce-image" @click="handleClick(el)">
    <img :src="el.url" :alt="el.alt || el.caption || 'Image'" />
    <div v-if="el.caption" class="rce-image__caption">{{ el.caption }}</div>
  </div>

  <!-- map -->
  <div v-else-if="type === 'map'" class="rce-map" @click="handleClick(el)">
    <div class="rce-map__placeholder">📍 {{ Number(el.la).toFixed(4) }}, {{ Number(el.lo).toFixed(4) }}</div>
  </div>

  <!-- checkbox -->
  <label v-else-if="type === 'checkbox'" class="rce-checkbox" @click.prevent="toggleCheckbox(el)">
    <input type="checkbox" :checked="checkedItems.has(el)" />
    <span>{{ el.text }}</span>
  </label>

  <!-- datePicker -->
  <input v-else-if="type === 'datePicker'" v-model="datePickerValue" class="rce-datepicker" type="date" />

  <!-- vertical -->
  <div
    v-else-if="type === 'vertical'"
    class="rce-vertical"
    :class="{ 'rce-vertical--border': el.border === 'border', 'rce-vertical--shadow': el.border === 'dropShadow' }"
  >
    <RichContentElement v-for="(child, i) in (el.elements ?? [])" :key="i" :element="child" :depth="d + 1" @action="onNested" />
  </div>

  <!-- horizontal -->
  <div v-else-if="type === 'horizontal'" class="rce-horizontal">
    <div v-for="(child, i) in (el.elements ?? [])" :key="i" class="rce-horizontal__item" :style="{ width: hWidths(el)[i] }">
      <RichContentElement :element="child" :depth="d + 1" @action="onNested" />
    </div>
  </div>

  <!-- carousel -->
  <div v-else-if="type === 'carousel'" class="rce-carousel">
    <div class="rce-carousel__track" :style="{ gap: `${el.padding || 8}px` }">
      <div v-for="(child, i) in (el.elements ?? [])" :key="i" class="rce-carousel__item">
        <RichContentElement :element="child" :depth="d + 1" @action="onNested" />
      </div>
    </div>
  </div>

  <!-- list / sectionList / section / checklist / buttonList -->
  <div v-else-if="['list','sectionList','section','checklist','buttonList'].includes(type)" class="rce-list">
    <div v-for="(child, i) in (el.elements ?? [])" :key="i" class="rce-list__item">
      <RichContentElement :element="child" :depth="d + 1" @action="onNested" />
    </div>
  </div>

  <!-- unknown -->
  <div v-else class="rce-unknown">{{ type }}</div>
</template>

<style scoped>
.rce-text {
  padding: 2px 0;
  line-height: 1.45;
  word-wrap: break-word;
  font-size: 13px;
  color: var(--text);
}

.rce-btn {
  display: block; width: 100%; padding: 7px 12px; margin: 3px 0;
  border: 1px solid var(--border); border-radius: 8px;
  background: var(--bg1); color: var(--text);
  font-size: 12px; cursor: pointer; text-align: center; transition: background 0.1s;
}
.rce-btn:hover { background: var(--bg3); }
.rce-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.rce-btn--submit { font-weight: 600; background: var(--acc); color: #fff; border-color: var(--acc); }
.rce-btn--submit:hover { filter: brightness(1.1); }

.rce-image { cursor: pointer; }
.rce-image img { max-width: 100%; height: auto; border-radius: 8px; display: block; }
.rce-image__caption { font-size: 11px; color: var(--text3); margin-top: 4px; }

.rce-map__placeholder {
  display: flex; align-items: center; gap: 6px; padding: 10px;
  background: var(--bg3); border-radius: 8px; font-size: 11px; color: var(--text2);
  cursor: pointer;
}

.rce-checkbox {
  display: flex; align-items: center; gap: 6px; padding: 4px 0;
  font-size: 13px; color: var(--text); cursor: pointer;
}
.rce-checkbox input { pointer-events: none; accent-color: var(--acc); }

.rce-datepicker {
  padding: 6px 8px; border: 1px solid var(--border);
  border-radius: 6px; font-size: 12px; background: var(--bg1); color: var(--text);
}

.rce-vertical { display: flex; flex-direction: column; gap: 4px; }
.rce-vertical--border { border: 1px solid var(--border); border-radius: 10px; padding: 10px; }
.rce-vertical--shadow { box-shadow: 0 2px 8px rgba(0,0,0,0.18); border-radius: 10px; padding: 10px; }

.rce-horizontal { display: flex; gap: 6px; }
.rce-horizontal__item { flex-shrink: 0; min-width: 0; }

.rce-carousel { overflow-x: auto; -webkit-overflow-scrolling: touch; }
.rce-carousel__track { display: flex; padding: 4px 0; width: max-content; }
.rce-carousel__item {
  flex-shrink: 0; min-width: 160px; max-width: 240px;
  background: var(--bg1); border: 1px solid var(--border); border-radius: 10px; padding: 10px;
}

.rce-list { display: flex; flex-direction: column; }
.rce-list__item { border-bottom: 1px solid var(--border2); padding: 5px 0; }
.rce-list__item:last-child { border-bottom: none; }

.rce-unknown { font-size: 11px; color: var(--text3); padding: 4px; }
</style>
