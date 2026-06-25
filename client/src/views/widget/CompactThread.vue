<script setup lang="ts">
import Icon from '../../components/Icon.vue';
import RichContent from '../../components/RichContent.vue';
import type { WorkspaceStore } from '../../composables/workspace-store';

const props = defineProps<{ w: WorkspaceStore }>();
const w = props.w;
</script>

<template>
  <div class="th">
    <div v-if="!w.active.value" class="th__empty">
      <Icon name="chat" :size="34" style="color: var(--text3)" />
      <div class="th__empty-text">Select a conversation</div>
    </div>

    <div
      v-else
      :ref="(el) => (w.threadEl.value = el as HTMLElement)"
      class="th__scroll"
    >
      <TransitionGroup name="msg">
        <template v-for="(m, i) in w.activeMessages.value" :key="m.sequence">
          <!-- Day separator -->
          <div v-if="w.startsNewDay(m, i)" :key="`day-${m.sequence}`" class="th__day">
            <span>{{ w.dayLabel(m.time) }}</span>
          </div>

          <!-- Conversation summary card -->
          <div v-if="m.kind === 'summary'" class="th__summary">
            <div class="th__summary-head">
              <span class="th__summary-title"><Icon name="sparkles" :size="13" /> Summary</span>
              <button class="th__copy" @click="w.copySummary(m)">
                <Icon :name="w.copiedId.value === m.sequence ? 'check' : 'copy'" :size="11" />
                {{ w.copiedId.value === m.sequence ? 'Copied' : 'Copy' }}
              </button>
            </div>
            <p v-if="w.parseSummary(m.body).synopsis" class="th__summary-syn">
              {{ w.parseSummary(m.body).synopsis }}
            </p>
            <div
              v-for="row in w.parseSummary(m.body).rows"
              :key="row.label"
              class="th__summary-row"
            >
              <span class="th__summary-label">{{ row.label }}</span>
              <span class="th__summary-val">{{ row.value }}</span>
            </div>
          </div>

          <!-- Auto / system message -->
          <div v-else-if="m.kind === 'auto'" class="th__sys">{{ m.body }}</div>

          <!-- Secure form invitation / submission -->
          <div v-else-if="m.secureForm" class="th__row" :class="m.isFromConsumer ? 'th__row--in' : 'th__row--out'">
            <div class="th__secform">
              <div class="th__secform-head">
                <Icon name="lock" :size="13" />
                <span>{{ m.secureForm.title || 'Secure form' }}</span>
              </div>
              <div class="th__secform-sub">
                {{ m.secureForm.submissionId ? 'Submitted by customer' : 'Sent to customer' }}
              </div>
              <button
                v-if="m.secureForm.submissionId"
                class="th__secform-btn"
                @click="w.viewSubmission(m)"
              >
                <Icon name="lock" :size="12" /> View submission
              </button>
            </div>
          </div>

          <!-- Rich content -->
          <div
            v-else-if="m.contentType === 'RichContentEvent' && m.body && w.tryParseJson(m.body)"
            class="th__row th__row--center"
          >
            <RichContent :content="w.tryParseJson(m.body)!" />
          </div>

          <!-- File attachment -->
          <div
            v-else-if="m.file"
            class="th__row"
            :class="m.isFromConsumer ? 'th__row--in' : 'th__row--out'"
          >
            <div class="th__bubble" :class="m.isFromConsumer ? 'th__bubble--in' : 'th__bubble--out'">
              <img
                v-if="w.isImageFile(m.file.fileType)"
                :src="w.imageSrc(m.file)"
                class="th__img"
                alt="attachment"
              />
              <a v-else :href="w.fileUrl(m.file)" target="_blank" rel="noopener" class="th__file">
                <Icon name="paperclip" :size="14" />
                {{ m.file.caption || m.file.fileType || 'File' }}
              </a>
              <div v-if="m.file.caption && w.isImageFile(m.file.fileType)" class="th__cap">
                {{ m.file.caption }}
              </div>
            </div>
          </div>

          <!-- Plain text bubble (body may carry LP rich-text HTML → v-html) -->
          <div
            v-else-if="m.body"
            class="th__row"
            :class="m.isFromConsumer ? 'th__row--in' : 'th__row--out'"
          >
            <div class="th__msg">
              <div class="th__bubble-row">
                <!-- Private: lock icon to the LEFT of the bubble (CCUI format) -->
                <span v-if="m.audience === 'AGENTS_AND_MANAGERS'" class="th__lock">
                  <Icon name="lock" :size="13" />
                </span>
                <div
                  class="th__bubble"
                  :class="m.isFromConsumer ? 'th__bubble--in' : 'th__bubble--out'"
                >
                  <div
                    class="th__text"
                    v-html="
                      w.translateActive.value &&
                      m.isFromConsumer &&
                      !w.showOriginal[w.translationKey(m.conversationId, m.sequence)] &&
                      w.translationCache[w.translationKey(m.conversationId, m.sequence)]
                        ? w.translationCache[w.translationKey(m.conversationId, m.sequence)]
                        : m.body
                    "
                  />
                  <!-- View Original / Translation toggle -->
                  <button
                    v-if="
                      w.translateActive.value &&
                      m.isFromConsumer &&
                      w.translationCache[w.translationKey(m.conversationId, m.sequence)]
                    "
                    class="th__xlate-toggle"
                    @click.stop="
                      w.showOriginal[w.translationKey(m.conversationId, m.sequence)] =
                        !w.showOriginal[w.translationKey(m.conversationId, m.sequence)]
                    "
                  >
                    <Icon name="globe" :size="10" />
                    {{ w.showOriginal[w.translationKey(m.conversationId, m.sequence)] ? 'View translation' : 'View original' }}
                  </button>
                </div>
              </div>
              <!-- Time row + 'Privately' tag -->
              <div v-if="w.isGroupTail(m, i)" class="th__meta">
                <span class="th__meta-time">{{ w.msgTime(m.time) }}</span>
                <span v-if="m.audience === 'AGENTS_AND_MANAGERS'" class="th__priv-tag">Privately</span>
              </div>
            </div>
          </div>
        </template>
      </TransitionGroup>
    </div>
  </div>
</template>

<style scoped>
.th {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: transparent;
}
.th__empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
.th__empty-text {
  font-size: 13px;
  color: var(--text3);
}
.th__scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.th__day {
  text-align: center;
  margin: 8px 0 4px;
}
.th__day span {
  font-size: 10px;
  font-weight: 600;
  color: var(--text3);
  background: var(--surf-input);
  padding: 2px 10px;
  border-radius: 999px;
}
.th__sys {
  text-align: center;
  font-size: 11px;
  color: var(--text3);
  padding: 4px 0;
}
.th__row {
  display: flex;
}
.th__row--in {
  justify-content: flex-start;
}
.th__row--out {
  justify-content: flex-end;
}
.th__row--center {
  justify-content: center;
}
.th__bubble {
  padding: 7px 11px;
  border-radius: 14px;
  font-size: 13px;
  line-height: 1.45;
  min-width: 0;
}
.th__bubble--in {
  background: var(--msg-visitor-bg);
  border: 1px solid var(--msg-visitor-border);
  color: var(--msg-visitor-text);
  border-bottom-left-radius: 5px;
}
.th__bubble--out {
  /* Solid agent bubble — matches the web app (not the translucent tint). */
  background: var(--msg-agent-solid);
  border: 1px solid var(--msg-agent-solid);
  color: var(--msg-agent-text);
  border-bottom-right-radius: 5px;
}
.th__text {
  white-space: pre-wrap;
  overflow-wrap: anywhere; /* break only long unbroken strings, not every char */
}
.th__text :deep(p) {
  margin: 0;
}
.th__text :deep(a) {
  color: inherit;
  text-decoration: underline;
}
.th__xlate-toggle {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-top: 5px;
  font-size: 10px;
  font-weight: 600;
  color: var(--acc);
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
  opacity: 0.85;
}
.th__xlate-toggle:hover {
  opacity: 1;
}
/* Message wrapper (bubble + meta row beneath) */
.th__msg {
  max-width: 86%;
  display: flex;
  flex-direction: column;
}
.th__row--out .th__msg {
  align-items: flex-end;
}
.th__bubble-row {
  display: flex;
  align-items: center;
  gap: 7px;
}
/* Private (agents-only) — lock icon to the LEFT of the bubble (CCUI format) */
.th__lock {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  flex-shrink: 0;
  color: var(--acc);
  background: var(--acc-tint);
  border: 1px solid var(--acc-border);
}
/* Time + 'Privately' tag row under the bubble */
.th__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 3px;
}
.th__meta-time {
  font-size: 9.5px;
  color: var(--text3);
}
.th__priv-tag {
  font-size: 9.5px;
  font-weight: 600;
  color: var(--acc);
  background: var(--acc-tint);
  border: 1px solid var(--acc-border);
  border-radius: 5px;
  padding: 0 6px;
}
.th__img {
  max-width: 220px;
  max-height: 220px;
  border-radius: 8px;
  display: block;
}
.th__file {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: inherit;
  text-decoration: underline;
}
.th__cap {
  font-size: 11px;
  margin-top: 4px;
  opacity: 0.8;
}
/* Summary */
.th__summary {
  padding: 12px 13px;
  border-radius: 13px;
  background: linear-gradient(180deg, var(--acc-tint), rgba(147, 51, 234, 0.03));
  border: 1px solid var(--acc-border);
}
.th__summary-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 7px;
}
.th__summary-title {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 700;
  color: var(--acc);
}
.th__copy {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  font-weight: 600;
  padding: 3px 7px;
  border-radius: 6px;
  color: var(--acc);
  background: var(--acc-tint);
  border: 1px solid var(--acc-border);
  cursor: pointer;
}
.th__summary-syn {
  font-size: 12px;
  color: var(--text);
  line-height: 1.5;
  margin-bottom: 6px;
}
.th__summary-row {
  display: flex;
  gap: 8px;
  font-size: 11.5px;
  padding: 2px 0;
}
.th__summary-label {
  color: var(--text3);
  min-width: 84px;
  flex-shrink: 0;
}
.th__summary-val {
  color: var(--text);
}
/* Secure form */
.th__secform {
  max-width: 82%;
  padding: 11px 13px;
  border-radius: 13px;
  background: var(--bg1);
  border: 1px solid var(--border);
}
.th__secform-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.th__secform-sub {
  font-size: 11px;
  color: var(--text3);
  margin: 3px 0 8px;
}
.th__secform-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  padding: 5px 10px;
  border-radius: 7px;
  color: #fff;
  background: var(--acc-grad);
  border: none;
  cursor: pointer;
}
</style>
