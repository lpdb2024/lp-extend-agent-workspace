<script setup lang="ts">
import Icon from "../components/Icon.vue";
import BlueprintBackground from "../components/BlueprintBackground.vue";
import RichContent from "../components/RichContent.vue";
import { ref, computed, watch } from "vue";
import {
  api,
  type Me,
  type ConvStatus,
  type AgentAvailState,
  type StatusReason,
} from "../lib/api";
import { useWorkspace } from "../composables/useWorkspace";

const expandedSummaries = ref(new Set<number>());
const toggleSummary = (idx: number) => {
  const s = new Set(expandedSummaries.value);
  s.has(idx) ? s.delete(idx) : s.add(idx);
  expandedSummaries.value = s;
};

const props = defineProps<{ me: Me; theme?: "dark" | "light" }>();
const emit = defineEmits<{
  (e: "sign-out"): void;
  (e: "toggle-theme"): void;
}>();

// All console logic lives in the shared composable so the compact widget can reuse
// it verbatim. Destructure into the setup scope so the template keeps referencing
// the same names it always has.
const w = useWorkspace(props.me, emit);
const {
  connected,
  conversations,
  messages,
  activeId,
  draft,
  rewritePromptText,
  rewriting,
  now,
  search,
  filter,
  filterMenuOpen,
  transcripts,
  transcriptLoading,
  hoverId,
  hoverY,
  ctxMenu,
  authMenuOpen,
  translateActive,
  translating,
  sendingTranslation,
  translationCache,
  showOriginal,
  translationKey,
  customerLangCache,
  showParticipants,
  skills,
  agents,
  agentsLoading,
  transferOpen,
  transferDialog,
  transferTab,
  transferSearch,
  transferSelected,
  transferring,
  filteredSkills,
  filteredAgents,
  filteredManagers,
  privateModal,
  privateDraft,
  toast,
  fileInput,
  threadEl,
  panelTab,
  panelTabs,
  panelContainerEl,
  notes,
  noteDraft,
  notesLoading,
  savingNote,
  customer,
  customerLoading,
  sdesRaw,
  pages,
  pagesLoading,
  pdcCategories,
  pdcLoading,
  pdcSearch,
  quickMenu,
  composerEl,
  formPicker,
  forms,
  formsLoading,
  sendingForm,
  formView,
  cobrowse,
  activeCobrowse,
  loadingThread,
  copiedId,
  active,
  activeMessages,
  hasNotes,
  pdcFiltered,
  allCanned,
  customerSections,
  participantList,
  timeline,
  visibleConversations,
  counts,
  filters,
  statusBarOrder,
  flash,
  upsertConversation,
  onAssigned,
  pingAlert,
  addMessage,
  loadTranscript,
  selectConversation,
  scrollThread,
  enrichConversations,
  prefetchTranscripts,
  dismissOverlays,
  onKeydown,
  smartRewrite,
  send,
  onFile,
  openFormPicker,
  sendForm,
  formIdFromInvitation,
  viewSubmission,
  selectTab,
  loadNotes,
  saveNote,
  loadCustomer,
  loadPages,
  loadPdc,
  usePdc,
  insertQuick,
  onComposerKey,
  loadFormsTab,
  cleanTz,
  tryParseJson,
  isGroupTail,
  pageTime,
  hostOf,
  startCobrowse,
  stopCobrowse,
  cobrowsePhaseLabel,
  cobrowseModeLabel,
  shortId,
  secondsLeft,
  liveStatus,
  transcriptMatches,
  toggleFilter,
  onRowEnter,
  onRowLeave,
  tooltipLines,
  openCtxMenu,
  endConversation,
  backToQueue,
  openTransferDialog,
  doTransfer,
  transferTo,
  openPrivateModal,
  sendPrivate,
  initials,
  avatarStyle,
  statusMeta,
  statusLabel,
  fmtDur,
  relTime,
  channelIcon,
  msgTime,
  dayLabel,
  startsNewDay,
  isImageFile,
  imageSrc,
  parseSummary,
  copySummary,
  FILE_ACCEPT,
  MAX_FILE_BYTES,
  fileUrl,
  historyList,
  historyLoading,
  historyDropdownOpen,
  historyExpanded,
  historyMessages,
  historyMessagesLoading,
  toggleHistoryConv,
  closeHistoryDropdown,
} = w;

// ── Engagement panel helpers ──────────────────────────────────────────────────
type SdeAny = {
  type: string;
  serverTimeStamp: number | null;
  data: Record<string, unknown>;
};
const sortDesc = (arr: SdeAny[]) =>
  [...arr].sort((a, b) => (b.serverTimeStamp ?? 0) - (a.serverTimeStamp ?? 0));
const bySdeType = (type: string) =>
  computed(() => (sdesRaw.value as SdeAny[]).filter((e) => e.type === type));

const engCart = computed(() => sortDesc(bySdeType("cart").value)[0]);
const engPurchases = computed(() => [
  ...new Map(
    bySdeType("purchase").value.map((e) => [
      e.data?.orderId ?? e.serverTimeStamp,
      e,
    ]),
  ).values(),
]);
const engViewed = computed(() => [
  ...new Map(
    bySdeType("viewedProduct")
      .value.flatMap((e) => (e.data?.products as any[]) ?? [])
      .map((p: any) => [p.product?.sku ?? p.product?.name, p]),
  ).values(),
]);
const engCtmrinfo = computed(() => sortDesc(bySdeType("ctmrinfo").value)[0]);
const engPersonal = computed(() => sortDesc(bySdeType("personal").value)[0]);
const engMrktInfo = computed(() => sortDesc(bySdeType("mrktInfo").value)[0]);
const engLeads = computed(() => [
  ...new Map(
    bySdeType("lead").value.map((e) => [
      e.data?.leadId ?? e.serverTimeStamp,
      e,
    ]),
  ).values(),
]);
const engServices = computed(() => [
  ...new Map(
    bySdeType("service").value.map((e) => [
      e.data?.serviceId ?? e.serverTimeStamp,
      e,
    ]),
  ).values(),
]);
const engErrors = computed(() => [
  ...new Map(
    bySdeType("error").value.map((e) => [e.data?.code ?? e.serverTimeStamp, e]),
  ).values(),
]);
const engKeywords = computed(() => [
  ...new Set(
    bySdeType("searchInfo").value.flatMap(
      (e) => (e.data?.keywords as string[]) ?? [],
    ),
  ),
]);

const hasEcommerce = computed(
  () =>
    !!(engCart.value || engPurchases.value.length || engViewed.value.length),
);
const hasVisitor = computed(
  () => !!(engCtmrinfo.value || engPersonal.value || engMrktInfo.value),
);
const hasJourney = computed(
  () =>
    !!(
      engLeads.value.length ||
      engServices.value.length ||
      engErrors.value.length ||
      engKeywords.value.length
    ),
);
const SERVICE_STATUS = [
  "Complete",
  "In Progress",
  "Approved",
  "Cancelled",
  "Not Approved",
  "Reviewed",
  "Missing Details",
  "Closed",
  "Removed",
  "Assigned",
  "Waiting for Customer",
  "Waiting for Response",
  "Pending",
  "Resolved",
];
const CHANNEL_NAMES = [
  "Direct",
  "Search",
  "Social",
  "Email",
  "Referral",
  "Paid Search",
  "Display",
];

// ── Agent availability state ──────────────────────────────────────────────────
const agentState = ref<AgentAvailState>(
  (props.me.agentState as AgentAvailState) ?? "ONLINE",
);
const stateChanging = ref(false);
const skillsOverflowOpen = ref(false);
const statusReasons = ref<StatusReason[]>([]);
const reasonSearch = ref("");
const pendingState = ref<"AWAY" | "BACK_SOON" | null>(null);

const AVAIL_STATES: { key: AgentAvailState; label: string; color: string }[] = [
  { key: "ONLINE",    label: "Online",    color: "#22c55e" },
  { key: "AWAY",      label: "Away",      color: "#f59e0b" },
  { key: "BACK_SOON", label: "Back soon", color: "#3b82f6" },
];

const currentStateColor = computed(
  () => AVAIL_STATES.find((s) => s.key === agentState.value)?.color ?? "#22c55e",
);

const filteredReasons = computed(() => {
  const q = reasonSearch.value.trim().toLowerCase();
  const list = statusReasons.value.filter(r => r.type === pendingState.value);
  if (!q) return list;
  return list.filter(r => r.text.toLowerCase().includes(q));
});

async function openAuthMenu() {
  authMenuOpen.value = !authMenuOpen.value;
  if (authMenuOpen.value && statusReasons.value.length === 0) {
    try {
      statusReasons.value = await api.getStatusReasons();
    } catch { /* non-fatal */ }
  }
}

async function changeState(state: AgentAvailState) {
  if (stateChanging.value) return;
  // AWAY and BACK_SOON show a reason picker first
  if ((state === "AWAY" || state === "BACK_SOON") && statusReasons.value.some(r => r.type === state)) {
    pendingState.value = state;
    reasonSearch.value = "";
    return;
  }
  await applyState(state, null);
}

async function applyState(state: AgentAvailState, reasonId: string | null) {
  stateChanging.value = true;
  try {
    await api.setAgentState(state);
    agentState.value = state;
    pendingState.value = null;
    reasonSearch.value = "";
  } catch {
    /* ignore on POC */
  } finally {
    stateChanging.value = false;
  }
}

async function doReturnToQueue() {
  if (stateChanging.value) return;
  stateChanging.value = true;
  try {
    await api.returnToQueue();
    agentState.value = "OFFLINE";
    authMenuOpen.value = false;
  } catch {
    /* ignore */
  } finally {
    stateChanging.value = false;
  }
}

const agentSkillIds = computed(() => props.me.skillIds ?? []);
const MAX_SKILL_CHIPS = 5;
const visibleSkillIds = computed(() =>
  agentSkillIds.value.slice(0, MAX_SKILL_CHIPS),
);
const overflowSkillIds = computed(() =>
  agentSkillIds.value.slice(MAX_SKILL_CHIPS),
);

// Close reason flyout when auth menu is dismissed externally
watch(authMenuOpen, (open) => {
  if (!open) pendingState.value = null;
});
</script>

<template>
  <div class="h-full flex flex-col" style="position: relative">
    <BlueprintBackground :is-dark="props.theme !== 'light'" />
    <div
      class="flex-1 flex min-h-0"
      style="
        position: relative;
        z-index: 1;
        overflow: hidden;
        min-width: 0;
        width: 100%;
      "
    >
      <!-- Icon rail -->
      <nav
        class="w-[50px] flex-shrink-0 flex flex-col items-center py-3 gap-1"
        style="
          background: var(--surf-rail);
          backdrop-filter: var(--blur-sm);
          border-right: 1px solid var(--border2);
        "
      >
        <img
          src="https://storage.googleapis.com/extend-platform/content/conversational-cloud.png"
          alt=""
          class="login__logo-svg"
          style="
            filter: drop-shadow(0 6px 20px rgba(141, 70, 235, 0.35));
            height: 35px;
            width: 35px;
            border-radius: 14px;
          "
        />
        <div class="flex-1"></div>
        <!-- Theme toggle -->
        <button
          class="w-8 h-8 rounded-lg flex items-center justify-center transition hover:brightness-110 mb-1"
          style="
            background: transparent;
            color: var(--text3);
            border: 1px solid transparent;
          "
          :title="
            props.theme === 'light' ? 'Switch to dark' : 'Switch to light'
          "
          @click="emit('toggle-theme')"
        >
          <!-- sun (shown in dark mode to switch to light) -->
          <svg
            v-if="props.theme !== 'light'"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="5" />
            <path
              d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
            />
          </svg>
          <!-- moon (shown in light mode to switch to dark) -->
          <svg
            v-else
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        </button>
        <!-- Agent state indicator -->
        <span
          class="size-2 rounded-full mb-2"
          :class="connected ? 'pulse-dot' : ''"
          :style="{ background: connected ? currentStateColor : '#ef4444' }"
          :title="connected ? agentState.replace('_', ' ').toLowerCase() : 'Disconnected'"
        ></span>
        <!-- Avatar / auth menu -->
        <div class="relative">
          <button
            class="w-8 h-8 rounded-lg overflow-hidden flex items-center justify-center text-xs font-bold transition"
            style="
              background: var(--acc-tint);
              color: var(--acc);
              border: 1px solid var(--acc-border);
            "
            :class="authMenuOpen ? 'brightness-125' : 'hover:brightness-110'"
            @click.stop="openAuthMenu"
          >
            <img
              v-if="props.me.imageUrl"
              :src="props.me.imageUrl"
              class="w-full h-full object-cover"
              alt=""
            />
            <span v-else>{{ initials(props.me.loginName) }}</span>
          </button>

          <Teleport to="body">
            <div v-if="authMenuOpen" class="auth-menu" @click.stop>
              <!-- Profile header -->
              <div class="auth-menu__header">
                <div class="auth-menu__avatar" style="position: relative">
                  <img
                    v-if="props.me.imageUrl"
                    :src="props.me.imageUrl"
                    class="w-full h-full object-cover"
                    alt=""
                  />
                  <span v-else>{{ initials(props.me.loginName) }}</span>
                  <!-- State dot -->
                  <span
                    class="auth-menu__state-dot"
                    :style="{ background: currentStateColor }"
                  ></span>
                </div>
                <div class="min-w-0">
                  <div
                    class="text-xs font-semibold truncate"
                    style="color: var(--text)"
                  >
                    {{ props.me.displayName || props.me.loginName }}
                  </div>
                  <div class="text-[10px] truncate" style="color: var(--text3)">
                    {{ props.me.email || props.me.loginName }}
                  </div>
                  <div class="text-[10px]" style="color: var(--text3)">
                    Account {{ props.me.accountId }}
                    <span v-if="props.me.agentGroupName">
                      · {{ props.me.agentGroupName }}</span
                    >
                  </div>
                </div>
              </div>

              <!-- Skills -->
              <div v-if="agentSkillIds.length" class="auth-menu__section">
                <div
                  class="overline"
                  style="color: var(--text3); margin-bottom: 6px"
                >
                  Skills
                </div>
                <div class="auth-menu__chips">
                  <span
                    v-for="id in visibleSkillIds"
                    :key="id"
                    class="auth-menu__chip"
                    >{{ id }}</span
                  >
                  <span
                    v-if="overflowSkillIds.length"
                    class="auth-menu__chip auth-menu__chip--overflow"
                    style="position: relative; cursor: default"
                    @mouseenter="skillsOverflowOpen = true"
                    @mouseleave="skillsOverflowOpen = false"
                  >
                    +{{ overflowSkillIds.length }} more
                    <div
                      v-if="skillsOverflowOpen"
                      class="auth-menu__overflow-list"
                    >
                      <span
                        v-for="id in overflowSkillIds"
                        :key="id"
                        class="auth-menu__chip"
                        >{{ id }}</span
                      >
                    </div>
                  </span>
                </div>
              </div>

              <div class="auth-menu__sep"></div>

              <!-- Availability -->
              <div class="auth-menu__section" style="position:relative">
                <div class="overline" style="color:var(--text3);margin-bottom:6px">Availability</div>
                <div class="auth-menu__state-grid">
                  <button
                    v-for="s in AVAIL_STATES"
                    :key="s.key"
                    class="auth-menu__state-btn"
                    :class="{
                      'auth-menu__state-btn--on': agentState === s.key,
                      'auth-menu__state-btn--pending': pendingState === s.key,
                    }"
                    :disabled="stateChanging"
                    @click="changeState(s.key)"
                  >
                    <span class="auth-menu__state-pip" :style="{ background: s.color }"></span>
                    {{ s.label }}
                    <Icon v-if="s.key === 'AWAY' || s.key === 'BACK_SOON'" name="chevron-right" :size="9" style="margin-left:auto;opacity:0.4" />
                  </button>
                </div>

                <!-- Reason flyout — pops to the right of the auth menu -->
                <Teleport to="body">
                  <div v-if="pendingState" class="auth-menu__reason-flyout" @click.stop>
                    <div class="auth-menu__reason-flyout-title overline" style="color:var(--text3)">
                      {{ pendingState === 'AWAY' ? 'Away' : 'Back soon' }} reason
                    </div>
                    <input
                      v-model="reasonSearch"
                      class="auth-menu__reason-search"
                      placeholder="Search or select away reason"
                      autofocus
                    />
                    <div class="auth-menu__reason-list">
                      <button
                        class="auth-menu__reason-item"
                        @click="applyState(pendingState, null)"
                      >
                        <span style="color:var(--text3);font-style:italic">No reason</span>
                      </button>
                      <button
                        v-for="r in filteredReasons"
                        :key="r.id"
                        class="auth-menu__reason-item"
                        @click="applyState(pendingState, r.id)"
                      >
                        {{ r.text }}
                      </button>
                      <div v-if="filteredReasons.length === 0 && reasonSearch" class="auth-menu__reason-empty">
                        No match
                      </div>
                    </div>
                  </div>
                </Teleport>
              </div>

              <div class="auth-menu__sep"></div>

              <!-- Actions -->
              <button
                class="auth-menu__item"
                @click="
                  emit('toggle-theme');
                  authMenuOpen = false;
                "
              >
                <Icon
                  :name="props.theme === 'dark' ? 'sun' : 'moon'"
                  :size="13"
                />
                <span>{{
                  props.theme === "dark" ? "Light mode" : "Dark mode"
                }}</span>
              </button>
              <button
                class="auth-menu__item auth-menu__item--warn"
                :disabled="stateChanging"
                @click="doReturnToQueue"
              >
                <Icon name="corner-down-left" :size="13" />
                <span>Return all to queue &amp; go offline</span>
              </button>
              <div class="auth-menu__sep"></div>
              <button
                class="auth-menu__item auth-menu__item--danger"
                @click="
                  emit('sign-out');
                  authMenuOpen = false;
                "
              >
                <Icon name="log-out" :size="13" />
                <span>Sign out</span>
              </button>
            </div>
          </Teleport>
        </div>
      </nav>

      <!-- Conversation list -->
      <aside
        class="flex flex-col min-h-0"
        style="
          width: 290px;
          flex-shrink: 0;
          background: var(--surf-panel);
          backdrop-filter: var(--blur-md);
          border-right: 1px solid var(--border2);
        "
      >
        <!-- Conv list header — same height as thread/panel headers -->
        <div
          class="px-4 flex items-center justify-between"
          style="
            height: 44px;
            flex-shrink: 0;
            border-bottom: 1px solid var(--border2);
            background: var(--surf-header);
            backdrop-filter: var(--blur-sm);
          "
        >
          <span
            class="text-sm font-bold tracking-tight"
            style="color: var(--text)"
            >My Conversations</span
          >
          <span
            class="text-[11px] rounded-full px-2 py-0.5"
            style="color: var(--text2); background: var(--badge-bg)"
            >{{ conversations.length }}</span
          >
        </div>

        <!-- Status bar + search -->
        <div
          class="px-3 pt-2.5 pb-2.5 space-y-2"
          style="border-bottom: 1px solid var(--border2)"
        >
          <!-- CCUI status bar: status icons with counts + filter dropdown -->
          <div class="flex items-center justify-between gap-1">
            <!-- Status filter buttons in a cmp-grp trough -->
            <div class="cmp-grp" style="gap: 1px; padding: 2px">
              <button
                v-for="s in statusBarOrder"
                :key="s"
                class="cmp-grp__btn"
                style="width: auto; padding: 0 5px; height: 24px; gap: 3px"
                :class="filter === s ? 'cmp-grp__btn--on' : ''"
                :title="`${counts[s]} ${s}`"
                @click="toggleFilter(s)"
              >
                <Icon
                  :name="statusMeta(s).icon"
                  :size="13"
                  :class="statusMeta(s).color"
                />
                <span class="statbtn-count" :class="`statcount--${s}`">{{
                  counts[s]
                }}</span>
              </button>
            </div>

            <!-- Filter icon + dropdown -->
            <div class="relative">
              <button
                class="cmp-grp__btn"
                style="width: 26px; height: 26px"
                :class="filter !== 'all' ? 'cmp-grp__btn--on' : ''"
                title="Filter conversations"
                @click.stop="filterMenuOpen = !filterMenuOpen"
              >
                <Icon name="filter" :size="13" style="color: var(--text2)" />
              </button>
              <div
                v-if="filterMenuOpen"
                class="absolute right-0 mt-1 w-40 z-30 ctx-menu"
                @click.stop
              >
                <button
                  v-for="f in filters"
                  :key="f.key"
                  class="ctx-item"
                  :style="filter === f.key ? 'color:#a78bfa' : ''"
                  @click="toggleFilter(f.key)"
                >
                  <Icon
                    v-if="f.key !== 'all'"
                    :name="statusMeta(f.key as ConvStatus).icon"
                    :size="14"
                    :class="statusMeta(f.key as ConvStatus).color"
                  />
                  <span v-else class="w-3.5 inline-block"></span>
                  <span class="flex-1 text-left">{{ f.label }}</span>
                  <span class="text-[10px]" style="color: var(--text3)">{{
                    counts[f.key]
                  }}</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Search (name, skill, full transcript) -->
          <div
            class="flex items-center gap-2 rounded-md px-2.5 py-1.5"
            style="
              background: rgba(255, 255, 255, 0.7);
              border: 1px solid var(--border2);
            "
          >
            <Icon
              name="search"
              :size="13"
              class="shrink-0"
              style="color: var(--text3)"
            />
            <input
              v-model="search"
              type="text"
              placeholder="Search transcript, name, skill…"
              class="flex-1 bg-transparent outline-none text-xs"
              style="color: var(--text)"
            />
            <button
              v-if="search"
              class="hover:text-white shrink-0"
              style="color: var(--text3)"
              @click="search = ''"
            >
              <Icon name="x" :size="13" />
            </button>
          </div>
        </div>

        <ul class="overflow-y-auto flex-1">
          <li
            v-for="c in visibleConversations"
            :key="c.conversationId"
            class="relative px-4 py-3 cursor-pointer border-l-2 transition"
            :style="
              c.conversationId === activeId
                ? 'border-color:var(--acc);background:var(--acc-tint);box-shadow:inset 0 -1px 0 var(--border2);'
                : 'border-color:transparent;box-shadow:inset 0 -1px 0 var(--border2);'
            "
            :class="
              c.conversationId === activeId ? '' : 'hover:bg-white/[0.03]'
            "
            @click="selectConversation(c.conversationId)"
            @contextmenu="openCtxMenu($event, c.conversationId)"
            @mouseenter="
              (e: MouseEvent) => {
                hoverY = (
                  e.currentTarget as HTMLElement
                ).getBoundingClientRect().top;
                onRowEnter(c.conversationId);
              }
            "
            @mouseleave="onRowLeave"
          >
            <div class="flex items-start gap-3">
              <!-- Avatar with status indicator -->
              <div class="relative shrink-0 mt-0.5">
                <div
                  class="size-9 rounded-full grid place-items-center text-xs font-semibold"
                  :style="avatarStyle(c.conversationId)"
                >
                  {{ initials(c.consumerName) }}
                </div>
                <span
                  class="absolute -bottom-1 -right-1 size-[18px] rounded-full grid place-items-center ring-2 text-white"
                  :class="[statusMeta(liveStatus(c)).dot, 'ring-[var(--bg)]']"
                  :title="statusLabel(c)"
                  ><Icon :name="statusMeta(liveStatus(c)).icon" :size="11"
                /></span>
              </div>

              <div class="min-w-0 flex-1">
                <div class="flex items-center justify-between gap-2">
                  <div class="flex items-center gap-1.5 min-w-0">
                    <img
                      v-if="channelIcon(c.channel)"
                      :src="channelIcon(c.channel)!"
                      class="w-3.5 h-3.5 rounded-sm shrink-0 object-contain"
                      :title="c.channel ?? ''"
                    />
                    <span
                      class="text-sm font-medium truncate"
                      :style="
                        c.unread
                          ? 'color:var(--text);font-weight:700'
                          : 'color:var(--text2)'
                      "
                      >{{ c.consumerName }}</span
                    >
                  </div>
                  <div class="flex items-center gap-1.5 shrink-0">
                    <span class="text-[10px]" style="color: var(--text3)">{{
                      relTime(c.updateTime)
                    }}</span>
                    <span
                      v-if="c.unread"
                      class="min-w-4 h-4 px-1 grid place-items-center rounded-full text-white text-[10px] font-bold"
                      style="background: var(--acc)"
                      >{{ c.unread }}</span
                    >
                  </div>
                </div>
                <div
                  class="text-xs truncate"
                  :style="c.unread ? 'color:var(--text)' : 'color:var(--text2)'"
                >
                  <span
                    v-if="c.lastMessage && !c.lastMessageFromConsumer"
                    style="color: var(--text3)"
                    >You: </span
                  ><span v-if="c.lastMessage" v-html="c.lastMessage" />
                  <span v-else>No messages yet</span>
                </div>
                <div class="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  <span v-if="c.skillName" class="badge badge--skill">{{
                    c.skillName
                  }}</span>
                  <span
                    class="badge"
                    :class="statusMeta(liveStatus(c)).badge"
                    >{{ statusLabel(c) }}</span
                  >
                </div>
              </div>
            </div>
          </li>
          <li
            v-if="!conversations.length"
            class="px-4 py-10 text-center text-sm"
            style="color: var(--text3)"
          >
            No open conversations assigned to you.
          </li>
          <li
            v-else-if="!visibleConversations.length"
            class="px-4 py-10 text-center text-sm"
            style="color: var(--text3)"
          >
            No conversations match this filter.
          </li>
        </ul>
        <!-- Hover transcript tooltip — fixed, escapes overflow clipping -->
        <Teleport to="body">
          <div
            v-if="hoverId"
            class="conv-tooltip"
            :style="{ top: `${hoverY}px` }"
          >
            <div
              class="text-[10px] uppercase tracking-wider mb-1.5 flex items-center justify-between"
              style="color: var(--text3)"
            >
              <span>Transcript</span>
              <span>last {{ tooltipLines(hoverId).length }} lines</span>
            </div>
            <div
              v-if="transcriptLoading[hoverId] && !tooltipLines(hoverId).length"
              class="text-xs animate-pulse"
              style="color: var(--text3)"
            >
              Loading…
            </div>
            <div
              v-else-if="!tooltipLines(hoverId).length"
              class="text-xs"
              style="color: var(--text3)"
            >
              No messages yet.
            </div>
            <div v-else class="space-y-1">
              <div
                v-for="(l, li) in tooltipLines(hoverId)"
                :key="li"
                class="text-xs leading-snug"
              >
                <span
                  class="font-semibold"
                  :style="
                    l.who === 'Customer'
                      ? 'color:var(--text2)'
                      : 'color:var(--acc)'
                  "
                  >{{ l.who }}:</span
                >
                <span style="color: var(--text2)"> {{ l.body }}</span>
              </div>
            </div>
          </div>
        </Teleport>
      </aside>

      <!-- Thread + right panel -->
      <main
        class="flex flex-1 min-h-0"
        style="
          overflow: hidden;
          min-width: 0;
          background: transparent;
        "
      >
        <!-- Thread column (500px fixed) -->
        <section
          v-if="active"
          class="flex flex-col min-h-0"
          style="
            width: 500px;
            flex-shrink: 0;
            border-right: 1px solid var(--border2);
            background: transparent;
          "
        >
          <div
            class="px-4 flex items-center justify-between"
            style="
              height: 44px;
              flex-shrink: 0;
              border-bottom: 1px solid var(--border2);
              background: var(--surf-header);
              backdrop-filter: var(--blur-sm);
            "
          >
            <div class="flex items-center gap-2.5">
              <!-- avatar circle with initials -->
              <div
                class="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0"
                :style="avatarStyle(active.conversationId)"
              >
                {{ initials(active.consumerName) }}
              </div>
              <div>
                <div class="flex items-center gap-1.5">
                  <img
                    v-if="channelIcon(active.channel)"
                    :src="channelIcon(active.channel)!"
                    class="w-3.5 h-3.5 rounded-sm object-contain"
                    :title="active.channel ?? ''"
                  />
                  <span
                    class="text-sm font-semibold"
                    style="color: var(--text)"
                    >{{ active.consumerName }}</span
                  >
                </div>
                <div class="text-[10px]" style="color: var(--text3)">
                  {{ active.conversationId }}
                </div>
              </div>
            </div>
            <div class="flex items-center gap-1.5">
              <!-- Translate toggle -->
              <button
                class="cmp-btn"
                :class="translateActive ? 'cmp-btn-on' : ''"
                title="Translation service"
                @click="translateActive = !translateActive"
              >
                <Icon name="languages" :size="14" />
              </button>
              <!-- Participants pill — hover shows names -->
              <div
                class="relative"
                @mouseenter="showParticipants = true"
                @mouseleave="showParticipants = false"
              >
                <div
                  class="flex items-center gap-1 px-2 py-1 rounded-lg text-xs cursor-default"
                  style="
                    background: var(--acc-tint);
                    border: 1px solid var(--acc-border);
                    color: var(--acc);
                  "
                >
                  <Icon name="users" :size="12" />
                  <span>{{ participantList.length }}</span>
                </div>
                <Transition name="msg">
                  <div
                    v-if="showParticipants"
                    class="absolute right-0 top-full mt-1 rounded-lg shadow-xl z-50 py-1.5 min-w-[160px]"
                    style="
                      background: var(--bg1);
                      border: 1px solid var(--border);
                    "
                  >
                    <div
                      v-for="p in participantList"
                      :key="p.role + p.name"
                      class="px-3 py-1.5 flex items-center gap-2"
                    >
                      <span
                        class="text-[10px] uppercase tracking-wide w-16 flex-shrink-0"
                        style="color: var(--text3)"
                        >{{ p.role }}</span
                      >
                      <span
                        class="text-xs truncate"
                        style="color: var(--text)"
                        >{{ p.name }}</span
                      >
                    </div>
                  </div>
                </Transition>
              </div>
              <!-- Conv actions dropdown -->
              <button
                class="cmp-btn"
                title="Conversation actions"
                @click.stop="openCtxMenu($event, active.conversationId)"
              >
                <Icon name="more-vertical" :size="14" />
              </button>
            </div>
          </div>

          <!-- Previous conversations ribbon -->
          <div
            v-if="active && (historyList[active.conversationId]?.length || historyLoading[active.conversationId])"
            class="prev-conv-ribbon"
          >
            <button
              class="prev-conv-toggle"
              :class="{ 'prev-conv-toggle--open': historyDropdownOpen }"
              :disabled="historyLoading[active.conversationId]"
              @click="historyDropdownOpen = !historyDropdownOpen"
            >
              <Icon name="history" :size="12" />
              <span v-if="historyLoading[active.conversationId]" class="animate-pulse">Loading history…</span>
              <span v-else>{{ historyList[active.conversationId].length }} previous conversation{{ historyList[active.conversationId].length === 1 ? '' : 's' }}</span>
              <Icon name="chevron-down" :size="11" class="prev-conv-chevron" />
            </button>

            <!-- Dropdown list -->
            <Transition name="hist-drop">
              <div v-if="historyDropdownOpen" class="hist-drop">
                <div
                  v-for="h in historyList[active.conversationId]"
                  :key="h.conversationId"
                  class="hist-item"
                >
                  <!-- Collapsed row -->
                  <button
                    class="hist-item-row"
                    @click="toggleHistoryConv(active.conversationId, h.conversationId)"
                  >
                    <Icon
                      name="chevron-right"
                      :size="11"
                      class="hist-item-chevron"
                      :class="{ 'hist-item-chevron--open': historyExpanded.has(h.conversationId) }"
                    />
                    <span class="hist-item-date">
                      {{ h.startTime ? new Date(h.startTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—' }}
                    </span>
                    <span v-if="h.skillName" class="hist-item-skill">{{ h.skillName }}</span>
                    <span v-if="h.agentName" class="hist-item-agent">{{ h.agentName }}</span>
                    <span class="hist-item-count">{{ h.messageCount }} msg{{ h.messageCount === 1 ? '' : 's' }}</span>
                  </button>

                  <!-- Expanded messages -->
                  <Transition name="hist-msgs">
                    <div
                      v-if="historyExpanded.has(h.conversationId)"
                      class="hist-msgs"
                    >
                      <div v-if="historyMessagesLoading[h.conversationId]" class="hist-msgs-loading animate-pulse">Loading…</div>
                      <template v-else-if="historyMessages[h.conversationId]?.length">
                        <div
                          v-for="hm in historyMessages[h.conversationId]"
                          :key="hm.sequence"
                          class="hist-msg"
                          :class="hm.isFromConsumer ? 'hist-msg--consumer' : 'hist-msg--agent'"
                        >
                          <div class="hist-msg-bubble">{{ hm.body }}</div>
                          <div class="hist-msg-meta">{{ msgTime(hm.time) }}</div>
                        </div>
                      </template>
                      <div v-else class="hist-msgs-loading" style="opacity:.45">No messages</div>
                    </div>
                  </Transition>
                </div>
              </div>
            </Transition>
          </div>

          <div
            ref="threadEl"
            class="flex-1 overflow-y-auto px-4 py-4 space-y-0.5"
            style="background: transparent"
          >
            <TransitionGroup name="msg">
              <template v-for="(m, i) in activeMessages" :key="m.sequence">
                <!-- Day separator -->
                <div
                  v-if="startsNewDay(m, i)"
                  class="flex items-center gap-3 py-2 mt-1"
                >
                  <div
                    class="flex-1 h-px"
                    style="background: var(--border2)"
                  ></div>
                  <span
                    class="text-[10px] uppercase tracking-wider"
                    style="color: var(--text3)"
                    >{{ dayLabel(m.time) }}</span
                  >
                  <div
                    class="flex-1 h-px"
                    style="background: var(--border2)"
                  ></div>
                </div>

                <!-- Auto / system message: centered text, no bubble -->
                <div v-if="m.kind === 'auto'" class="flex justify-center py-1">
                  <div
                    class="max-w-[80%] text-center text-xs leading-relaxed"
                    style="color: var(--text3)"
                  >
                    <span v-html="m.body" />
                  </div>
                </div>

                <!-- Automated conversation summary card -->
                <div
                  v-else-if="m.kind === 'summary'"
                  class="flex justify-center"
                >
                  <div class="summary-card w-full max-w-[88%]">
                    <div class="flex items-center justify-between mb-2">
                      <div
                        class="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider"
                        style="color: var(--acc)"
                      >
                        <Icon name="sparkles" :size="13" />
                        Automated conversation summary
                      </div>
                      <button
                        class="summary-copy"
                        :title="
                          copiedId === m.sequence ? 'Copied' : 'Copy summary'
                        "
                        @click="copySummary(m)"
                      >
                        <Icon
                          :name="copiedId === m.sequence ? 'check' : 'copy'"
                          :size="13"
                        />
                        {{ copiedId === m.sequence ? "Copied" : "Copy" }}
                      </button>
                    </div>
                    <p
                      v-if="parseSummary(m.body).synopsis"
                      class="text-sm leading-relaxed mb-2.5"
                      style="color: var(--text)"
                    >
                      {{ parseSummary(m.body).synopsis }}
                    </p>
                    <dl
                      v-if="parseSummary(m.body).rows.length"
                      class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs"
                    >
                      <template
                        v-for="(r, ri) in parseSummary(m.body).rows"
                        :key="ri"
                      >
                        <dt
                          class="whitespace-nowrap"
                          style="color: var(--text3)"
                        >
                          {{ r.label }}
                        </dt>
                        <dd
                          class="min-w-0 break-words"
                          style="color: var(--text2)"
                        >
                          {{ r.value }}
                        </dd>
                      </template>
                    </dl>
                  </div>
                </div>

                <!-- Secure-form invitation / submission -->
                <div v-else-if="m.secureForm" class="flex justify-center">
                  <div class="secform-card w-full max-w-[88%]">
                    <div class="flex items-center gap-2 mb-1.5">
                      <Icon name="lock" :size="14" style="color: var(--acc)" />
                      <span
                        class="text-[11px] font-semibold uppercase tracking-wider"
                        style="color: var(--acc)"
                      >
                        {{
                          m.secureForm.kind === "invitation"
                            ? "Secure form sent"
                            : "Secure form submitted"
                        }}
                      </span>
                    </div>
                    <div class="text-sm" style="color: var(--text)">
                      {{ m.secureForm.title || "Secure form" }}
                    </div>
                    <div
                      v-if="m.secureForm.kind === 'invitation'"
                      class="text-xs mt-1"
                      style="color: var(--text3)"
                    >
                      Waiting for the customer to fill it in…
                    </div>
                    <button
                      v-else
                      class="secform-btn mt-2.5"
                      @click="viewSubmission(m)"
                    >
                      <Icon name="lock" :size="13" /> View submission
                    </button>
                  </div>
                </div>

                <div
                  v-else
                  class="flex flex-col"
                  :class="[
                    m.contentType === 'RichContentEvent'
                      ? 'items-center'
                      : m.isFromConsumer
                        ? 'items-start'
                        : 'items-end',
                    isGroupTail(m, i) ? 'mb-2.5' : '',
                  ]"
                >
                  <div
                    :class="
                      m.contentType === 'RichContentEvent'
                        ? 'w-full'
                        : 'max-w-[70%] px-3.5 py-2 text-sm leading-relaxed ' +
                          (m.isFromConsumer
                            ? isGroupTail(m, i)
                              ? 'rounded-xl rounded-tl-sm'
                              : 'rounded-lg rounded-tl-sm rounded-bl-sm'
                            : isGroupTail(m, i)
                              ? 'rounded-xl rounded-tr-sm'
                              : 'rounded-lg rounded-tr-sm rounded-br-sm')
                    "
                    :style="
                      m.contentType === 'RichContentEvent'
                        ? ''
                        : m.isFromConsumer
                          ? 'background:var(--msg-visitor-solid);color:var(--msg-visitor-text);'
                          : 'background:var(--msg-agent-solid);color:var(--msg-agent-text);'
                    "
                  >
                    <!-- Shared file -->
                    <template v-if="m.file">
                      <a
                        v-if="isImageFile(m.file.fileType)"
                        :href="fileUrl(m.file)"
                        target="_blank"
                        rel="noopener"
                        class="block"
                      >
                        <img
                          :src="imageSrc(m.file)"
                          :alt="m.file.caption || 'shared image'"
                          class="rounded-lg max-w-[260px] max-h-[260px] object-contain bg-black/20"
                        />
                      </a>
                      <a
                        v-else
                        :href="fileUrl(m.file)"
                        target="_blank"
                        rel="noopener"
                        class="flex items-center gap-2.5 rounded-lg bg-black/20 px-3 py-2 hover:bg-black/30 transition"
                      >
                        <Icon
                          name="paperclip"
                          :size="18"
                          class="shrink-0 opacity-80"
                        />
                        <span class="min-w-0">
                          <span class="block truncate text-sm">{{
                            m.file.caption ||
                            `${(m.file.fileType || "file").toUpperCase()} file`
                          }}</span>
                          <span
                            class="block text-[10px] uppercase tracking-wide opacity-50"
                            >{{ m.file.fileType || "file" }} · open</span
                          >
                        </span>
                      </a>
                      <div v-if="m.body" class="mt-1.5" v-html="m.body" />
                    </template>
                    <template
                      v-else-if="
                        m.contentType === 'RichContentEvent' &&
                        m.body &&
                        tryParseJson(m.body)
                      "
                    >
                      <RichContent :content="tryParseJson(m.body)!" />
                    </template>
                    <template v-else>
                      <span v-html="
                        translateActive && m.isFromConsumer && !showOriginal[translationKey(active.conversationId, m.sequence)] && translationCache[translationKey(active.conversationId, m.sequence)]
                          ? translationCache[translationKey(active.conversationId, m.sequence)]
                          : m.body
                      " />
                      <!-- View Original / View Translation toggle -->
                      <button
                        v-if="translateActive && m.isFromConsumer && translationCache[translationKey(active.conversationId, m.sequence)]"
                        class="msg-translate-toggle"
                        @click.stop="showOriginal[translationKey(active.conversationId, m.sequence)] = !showOriginal[translationKey(active.conversationId, m.sequence)]"
                      >
                        <Icon name="globe" :size="10" />
                        {{ showOriginal[translationKey(active.conversationId, m.sequence)] ? 'View Translation' : 'View Original' }}
                      </button>
                    </template>
                  </div>
                  <!-- Name + time shown only on last message in a group (or non-PLAIN_TEXT) -->
                  <div
                    v-if="isGroupTail(m, i)"
                    class="flex items-center gap-1.5 mt-0.5 px-1"
                    :class="m.isFromConsumer ? '' : 'flex-row-reverse'"
                  >
                    <span class="text-[10px]" style="color: var(--text3)">{{
                      m.role === "ASSIGNED_AGENT"
                        ? props.me.loginName
                        : m.role === "MANAGER"
                          ? m.role
                          : active.consumerName
                    }}</span>
                    <span class="text-[10px]" style="color: var(--text3)"
                      >·</span
                    >
                    <span class="text-[10px]" style="color: var(--text3)">{{
                      msgTime(m.time)
                    }}</span>
                  </div>
                </div>
              </template>
            </TransitionGroup>
            <div
              v-if="loadingThread && !activeMessages.length"
              class="text-center text-sm text-slate-500 pt-10 animate-pulse"
            >
              Loading messages…
            </div>
            <div
              v-else-if="!activeMessages.length"
              class="text-center text-sm text-slate-500 pt-10"
            >
              No messages yet.
            </div>
          </div>

          <!-- Composer -->
          <div
            class="relative"
            style="
              background: var(--surf-comp);
              backdrop-filter: var(--blur-md);
              border-top: 1px solid var(--border2);
            "
          >
            <!-- Hotkey quick-content menu -->
            <div v-if="quickMenu" class="quick-menu">
              <div
                class="flex items-center justify-between px-3 py-2"
                style="border-bottom: 1px solid var(--border2)"
              >
                <span class="text-xs font-semibold" style="color: var(--text)"
                  >Quick content · "{{ quickMenu.prefix }}"</span
                >
                <button
                  class="hover:text-white"
                  style="color: var(--text3)"
                  @click="quickMenu = null"
                >
                  <Icon name="x" :size="13" />
                </button>
              </div>
              <button
                v-for="it in quickMenu.items"
                :key="it.id"
                class="flex items-center gap-3 w-full px-3 py-2 text-left hover:bg-white/5 transition"
                @click="insertQuick(it)"
              >
                <span
                  class="text-sm flex-1 truncate"
                  style="color: var(--text)"
                  >{{ it.text || it.title }}</span
                >
                <span class="badge badge--muted font-mono">{{
                  it.hotkey?.suffix
                }}</span>
              </button>
            </div>

            <!-- Row 1: formatting -->
            <div
              class="flex items-center gap-0.5 px-3 py-1.5"
              style="border-bottom: 1px solid var(--border2)"
            >
              <button class="cmp-btn" title="Bold">
                <Icon name="bold" :size="13" />
              </button>
              <button class="cmp-btn" title="Italic">
                <Icon name="italic" :size="13" />
              </button>
              <button class="cmp-btn" title="Underline">
                <Icon name="underline" :size="13" />
              </button>
              <button class="cmp-btn" title="Link">
                <Icon name="link" :size="13" />
              </button>
              <button class="cmp-btn" title="Emoji">
                <Icon name="smile" :size="13" />
              </button>
            </div>

            <!-- Row 2: textarea -->
            <div class="px-3 py-2">
              <textarea
                ref="composerEl"
                v-model="draft"
                rows="2"
                placeholder="Type a message…  (Enter to send · hotkey then → for quick content)"
                class="w-full bg-transparent outline-none resize-none text-sm"
                style="
                  color: var(--text);
                  min-height: 44px;
                  max-height: 120px;
                  line-height: 1.6;
                "
                @keydown.enter.exact.prevent="send"
                @keydown="onComposerKey"
              ></textarea>
            </div>

            <!-- Row 3: feature buttons + send -->
            <div class="flex items-center gap-0.5 px-3 pb-2.5">
              <button
                class="cmp-btn cmp-ai"
                title="Smart rewrite"
                :disabled="rewriting || !draft.trim()"
                @click="smartRewrite"
              >
                <Icon :name="rewriting ? 'moon' : 'sparkles'" :size="13" /><span
                  class="text-[11px] font-semibold ml-1"
                  >{{ rewriting ? "Rewriting…" : "Rewrite" }}</span
                >
              </button>
              <button class="cmp-btn cmp-ai" title="Translate">
                <Icon name="globe" :size="13" /><span
                  class="text-[11px] font-semibold ml-1"
                  >Translate</span
                >
              </button>
              <div class="cmp-sep"></div>
              <!-- Embedded button group -->
              <div class="cmp-grp">
                <button
                  class="cmp-grp__btn"
                  title="Attach file"
                  @click="fileInput?.click()"
                >
                  <Icon name="paperclip" :size="13" />
                </button>
                <button
                  class="cmp-grp__btn"
                  title="Canned responses"
                  @click="selectTab('pdc')"
                >
                  <Icon name="chat" :size="13" />
                </button>
                <button
                  class="cmp-grp__btn"
                  title="Secure forms"
                  @click="openFormPicker()"
                >
                  <Icon name="lock" :size="13" />
                </button>
                <button
                  class="cmp-grp__btn"
                  title="Voice call"
                  @click="startCobrowse('voice-call')"
                >
                  <Icon name="phone" :size="13" />
                </button>
                <button
                  class="cmp-grp__btn"
                  title="Video call"
                  @click="startCobrowse('video-call')"
                >
                  <Icon name="video" :size="13" />
                </button>
                <button
                  class="cmp-grp__btn"
                  :class="
                    activeCobrowse && activeCobrowse.phase !== 'ended'
                      ? 'cmp-grp__btn--on'
                      : ''
                  "
                  title="Cobrowse"
                  @click="selectTab('cobrowse')"
                >
                  <Icon name="monitor" :size="13" />
                </button>
              </div>
              <div class="flex-1"></div>
              <button
                class="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-semibold text-white transition hover:brightness-110"
                style="background: var(--acc-grad)"
                :disabled="sendingTranslation"
                @click="send"
              >
                <template v-if="sendingTranslation">
                  <svg class="animate-spin" style="width:12px;height:12px" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" stroke-dasharray="31.4" stroke-dashoffset="10" /></svg>
                  Translating…
                </template>
                <template v-else>
                  <Icon name="send" :size="12" />
                  Send
                  <span
                    v-if="translateActive && active && customerLangCache[active.conversationId] && customerLangCache[active.conversationId].toLowerCase() !== (props.me.accountLang ?? 'en-US').toLowerCase()"
                    class="send-lang-badge"
                  >{{ customerLangCache[active.conversationId] }}</span>
                </template>
              </button>
            </div>
          </div>
        </section>

        <!-- Right panel strip (fills remaining space; panels inside are 400px each) -->
        <section
          v-if="active"
          style="
            flex: 1 1 0;
            min-width: 0;
            width: 0;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            background: transparent;
            border-left: 1px solid var(--border2);
          "
        >
          <!-- Tab bar -->
          <div
            class="flex items-center gap-0.5 px-2 overflow-x-auto"
            style="
              height: 44px;
              flex-shrink: 0;
              border-bottom: 1px solid var(--border2);
              background: var(--surf-header);
              backdrop-filter: var(--blur-sm);
            "
          >
            <button
              v-for="t in panelTabs"
              :key="t.key"
              class="paneltab"
              :class="panelTab === t.key ? 'paneltab--on' : ''"
              @click="selectTab(t.key)"
            >
              <Icon :name="t.icon" :size="14" />
              <span>{{ t.label }}</span>
              <!-- live cobrowse dot -->
              <span
                v-if="
                  t.key === 'cobrowse' &&
                  activeCobrowse &&
                  activeCobrowse.phase !== 'ended'
                "
                class="size-1.5 rounded-full bg-emerald-400"
              ></span>
              <!-- notes-present badge -->
              <span
                v-else-if="t.key === 'notes' && hasNotes"
                class="size-1.5 rounded-full"
                style="background: var(--acc)"
              ></span>
            </button>
          </div>

          <!-- Panel strip: scroll container clips to section width, inner row is 6×400px -->
          <div
            ref="panelContainerEl"
            style="
              flex: 1 1 0;
              min-height: 0;
              overflow-x: scroll;
              overflow-y: hidden;
              scrollbar-width: none;
              scroll-behavior: smooth;
              padding: 6px 6px;
              box-sizing: border-box;
              background: transparent;
            "
          >
            <div
              style="
                display: flex;
                flex-direction: row;
                gap: 3px;
                width: calc(6 * 400px + 5 * 3px);
                height: 100%;
              "
            >
              <!-- ── Customer (Messaging Interactions API) ── -->
              <div
                data-panel="sdes"
                tabindex="-1"
                class="panel-col"
                style="padding: 12px 10px"
              >
                <div
                  v-if="customerLoading"
                  class="text-sm animate-pulse px-2"
                  style="color: var(--text3)"
                >
                  Loading…
                </div>
                <div
                  v-else-if="!customerSections.length"
                  class="text-sm px-2"
                  style="color: var(--text3)"
                >
                  No customer data available for this conversation.
                </div>
                <template v-else>
                  <div
                    v-for="sec in customerSections"
                    :key="sec.title"
                    class="cust-section"
                  >
                    <div class="cust-section__title">{{ sec.title }}</div>
                    <dl class="cust-section__dl">
                      <template v-for="r in sec.rows" :key="r.label">
                        <dt class="cust-dt">{{ r.label }}</dt>
                        <dd class="cust-dd" :title="r.value">{{ r.value }}</dd>
                      </template>
                    </dl>
                  </div>
                  <!-- ── Engagement Attributes ── -->
                  <template v-if="hasEcommerce || hasVisitor || hasJourney">
                    <!-- eCommerce -->
                    <template v-if="hasEcommerce">
                      <div class="cust-section__title">eCommerce</div>

                      <div v-if="engCart" class="eng-card">
                        <div class="eng-card__head">
                          <span class="eng-card__label">Cart</span>
                          <span class="eng-card__currency">{{
                            engCart.data?.currency
                          }}</span>
                        </div>
                        <div class="eng-kv">
                          <span>Total</span
                          ><span>{{
                            engCart.data?.total != null
                              ? `$${Number(engCart.data.total).toFixed(2)}`
                              : "—"
                          }}</span>
                          <span>Items</span
                          ><span>{{ engCart.data?.numItems ?? "—" }}</span>
                        </div>
                        <div
                          v-if="(engCart.data?.products as any[])?.length"
                          class="eng-products"
                        >
                          <div
                            v-for="(p, pi) in engCart.data.products as any[]"
                            :key="pi"
                            class="eng-product"
                          >
                            <span class="eng-product__name">{{
                              p.product?.name
                            }}</span>
                            <span class="eng-product__meta"
                              >{{ p.product?.category }} ·
                              {{ p.product?.sku }}</span
                            >
                            <span class="eng-product__price"
                              >${{ Number(p.product?.price ?? 0).toFixed(2) }} ×
                              {{ p.quantity ?? 1 }}</span
                            >
                          </div>
                        </div>
                      </div>

                      <div
                        v-if="engPurchases.length"
                        class="eng-card eng-card--purchase"
                      >
                        <div class="eng-card__head">
                          <span class="eng-card__label">Purchases</span>
                        </div>
                        <div
                          v-for="(ord, oi) in engPurchases"
                          :key="oi"
                          :class="{ 'eng-multi-item': oi > 0 }"
                        >
                          <div class="eng-kv">
                            <span>Order ID</span
                            ><span>{{ ord.data?.orderId ?? "—" }}</span>
                            <span>Total</span
                            ><span>{{
                              ord.data?.total != null
                                ? `$${Number(ord.data.total).toFixed(2)} ${ord.data?.currency ?? ""}`
                                : "—"
                            }}</span>
                          </div>
                          <div
                            v-if="(ord.data?.cart as any)?.products?.length"
                            class="eng-products"
                          >
                            <div
                              v-for="(p, pi) in (ord.data.cart as any).products"
                              :key="pi"
                              class="eng-product"
                            >
                              <span class="eng-product__name">{{
                                (p as any).product?.name
                              }}</span>
                              <span class="eng-product__meta"
                                >{{ (p as any).product?.category }} ·
                                {{ (p as any).product?.sku }}</span
                              >
                              <span class="eng-product__price"
                                >${{
                                  Number(
                                    (p as any).product?.price ?? 0,
                                  ).toFixed(2)
                                }}
                                × {{ (p as any).quantity ?? 1 }}</span
                              >
                            </div>
                          </div>
                        </div>
                      </div>

                      <div v-if="engViewed.length" class="eng-card">
                        <div class="eng-card__head">
                          <span class="eng-card__label">Viewed Products</span>
                        </div>
                        <div class="eng-products">
                          <div
                            v-for="(p, pi) in engViewed"
                            :key="pi"
                            class="eng-product"
                          >
                            <span class="eng-product__name">{{
                              (p as any).product?.name
                            }}</span>
                            <span class="eng-product__meta"
                              >{{ (p as any).product?.category }} · ${{
                                Number((p as any).product?.price ?? 0).toFixed(
                                  2,
                                )
                              }}</span
                            >
                          </div>
                        </div>
                      </div>
                    </template>

                    <!-- Visitor Info -->
                    <template v-if="hasVisitor">
                      <div class="cust-section__title">Visitor Info</div>

                      <div v-if="engCtmrinfo" class="eng-card">
                        <div class="eng-card__head">
                          <span class="eng-card__label">Customer Info</span>
                        </div>
                        <div class="eng-kv">
                          <template v-if="engCtmrinfo.data?.customerId"
                            ><span>ID</span
                            ><span>{{
                              engCtmrinfo.data.customerId
                            }}</span></template
                          >
                          <template v-if="engCtmrinfo.data?.userName"
                            ><span>Username</span
                            ><span>{{
                              engCtmrinfo.data.userName
                            }}</span></template
                          >
                          <template v-if="engCtmrinfo.data?.customerType"
                            ><span>Type</span
                            ><span>{{
                              engCtmrinfo.data.customerType
                            }}</span></template
                          >
                          <template v-if="engCtmrinfo.data?.customerStatus"
                            ><span>Status</span
                            ><span>{{
                              engCtmrinfo.data.customerStatus
                            }}</span></template
                          >
                          <template v-if="engCtmrinfo.data?.balance != null"
                            ><span>Balance</span
                            ><span
                              >${{
                                Number(engCtmrinfo.data.balance).toFixed(2)
                              }}
                              {{ engCtmrinfo.data?.currency }}</span
                            ></template
                          >
                          <template v-if="engCtmrinfo.data?.accountName"
                            ><span>Account</span
                            ><span>{{
                              engCtmrinfo.data.accountName
                            }}</span></template
                          >
                          <template v-if="engCtmrinfo.data?.companyBranch"
                            ><span>Branch</span
                            ><span>{{
                              engCtmrinfo.data.companyBranch
                            }}</span></template
                          >
                          <template v-if="engCtmrinfo.data?.role"
                            ><span>Role</span
                            ><span>{{ engCtmrinfo.data.role }}</span></template
                          >
                          <template v-if="engCtmrinfo.data?.socialId"
                            ><span>Social ID</span
                            ><span>{{
                              engCtmrinfo.data.socialId
                            }}</span></template
                          >
                          <template v-if="engCtmrinfo.data?.registrationDate"
                            ><span>Registered</span
                            ><span>{{
                              [
                                (engCtmrinfo.data.registrationDate as any).day,
                                (engCtmrinfo.data.registrationDate as any)
                                  .month,
                                (engCtmrinfo.data.registrationDate as any).year,
                              ].join("/")
                            }}</span></template
                          >
                          <template v-if="engCtmrinfo.data?.lastPaymentDate"
                            ><span>Last payment</span
                            ><span>{{
                              [
                                (engCtmrinfo.data.lastPaymentDate as any).day,
                                (engCtmrinfo.data.lastPaymentDate as any).month,
                                (engCtmrinfo.data.lastPaymentDate as any).year,
                              ].join("/")
                            }}</span></template
                          >
                        </div>
                      </div>

                      <div v-if="engPersonal" class="eng-card">
                        <div class="eng-card__head">
                          <span class="eng-card__label">Personal Info</span>
                        </div>
                        <div class="eng-kv">
                          <template
                            v-if="
                              engPersonal.data?.name ||
                              engPersonal.data?.surname
                            "
                            ><span>Name</span
                            ><span>{{
                              [
                                engPersonal.data?.name,
                                engPersonal.data?.surname,
                              ]
                                .filter(Boolean)
                                .join(" ")
                            }}</span></template
                          >
                          <template v-if="engPersonal.data?.gender"
                            ><span>Gender</span
                            ><span>{{
                              engPersonal.data.gender
                            }}</span></template
                          >
                          <template v-if="engPersonal.data?.language"
                            ><span>Language</span
                            ><span>{{
                              engPersonal.data.language
                            }}</span></template
                          >
                          <template v-if="engPersonal.data?.company"
                            ><span>Company</span
                            ><span>{{
                              engPersonal.data.company
                            }}</span></template
                          >
                          <template
                            v-if="
                              (engPersonal.data?.customerAge as any)
                                ?.customerAgeInYears
                            "
                            ><span>Age</span
                            ><span>{{
                              Math.floor(
                                (engPersonal.data.customerAge as any)
                                  .customerAgeInYears,
                              )
                            }}</span></template
                          >
                        </div>
                        <div
                          v-if="(engPersonal.data?.contacts as any[])?.length"
                        >
                          <div
                            v-for="(c, ci) in engPersonal.data
                              .contacts as any[]"
                            :key="ci"
                            class="eng-kv"
                            style="margin-top: 4px"
                          >
                            <template v-if="c.personalContact?.email"
                              ><span>Email</span
                              ><span>{{
                                c.personalContact.email
                              }}</span></template
                            >
                            <template v-if="c.personalContact?.phone"
                              ><span>Phone</span
                              ><span>{{
                                c.personalContact.phone
                              }}</span></template
                            >
                            <template v-if="c.personalContact?.address?.country"
                              ><span>Location</span
                              ><span>{{
                                [
                                  c.personalContact.address.region,
                                  c.personalContact.address.country,
                                ]
                                  .filter(Boolean)
                                  .join(", ")
                              }}</span></template
                            >
                          </div>
                        </div>
                      </div>

                      <div v-if="engMrktInfo" class="eng-card">
                        <div class="eng-card__head">
                          <span class="eng-card__label">Marketing Source</span>
                        </div>
                        <div class="eng-kv">
                          <template
                            v-if="engMrktInfo.data?.originatingChannel != null"
                            ><span>Channel</span
                            ><span>{{
                              CHANNEL_NAMES[
                                Number(engMrktInfo.data.originatingChannel)
                              ] ?? engMrktInfo.data.originatingChannel
                            }}</span></template
                          >
                          <template v-if="engMrktInfo.data?.affiliate"
                            ><span>Affiliate</span
                            ><span>{{
                              engMrktInfo.data.affiliate
                            }}</span></template
                          >
                          <template v-if="engMrktInfo.data?.campaignId"
                            ><span>Campaign</span
                            ><span>{{
                              engMrktInfo.data.campaignId
                            }}</span></template
                          >
                        </div>
                      </div>
                    </template>

                    <!-- Visitor Journey -->
                    <template v-if="hasJourney">
                      <div class="cust-section__title">Visitor Journey</div>

                      <div v-if="engLeads.length" class="eng-card">
                        <div class="eng-card__head">
                          <span class="eng-card__label">Leads</span>
                        </div>
                        <div
                          v-for="(lead, li) in engLeads"
                          :key="li"
                          :class="{ 'eng-multi-item': li > 0 }"
                        >
                          <div class="eng-kv">
                            <template v-if="lead.data?.topic"
                              ><span>Topic</span
                              ><span>{{ lead.data.topic }}</span></template
                            >
                            <template v-if="lead.data?.value != null"
                              ><span>Value</span
                              ><span
                                >${{ Number(lead.data.value).toFixed(2) }}
                                {{ lead.data?.currency }}</span
                              ></template
                            >
                            <template v-if="lead.data?.leadId"
                              ><span>Lead ID</span
                              ><span>{{ lead.data.leadId }}</span></template
                            >
                          </div>
                        </div>
                      </div>

                      <div v-if="engServices.length" class="eng-card">
                        <div class="eng-card__head">
                          <span class="eng-card__label">Service Activity</span>
                        </div>
                        <div
                          v-for="(svc, si) in engServices"
                          :key="si"
                          :class="{ 'eng-multi-item': si > 0 }"
                        >
                          <div class="eng-kv">
                            <template v-if="svc.data?.topic"
                              ><span>Topic</span
                              ><span>{{ svc.data.topic }}</span></template
                            >
                            <template v-if="svc.data?.status != null"
                              ><span>Status</span
                              ><span>{{
                                SERVICE_STATUS[svc.data.status as number] ??
                                svc.data.status
                              }}</span></template
                            >
                            <template v-if="svc.data?.category"
                              ><span>Category</span
                              ><span>{{ svc.data.category }}</span></template
                            >
                            <template v-if="svc.data?.serviceId"
                              ><span>Service ID</span
                              ><span>{{ svc.data.serviceId }}</span></template
                            >
                          </div>
                        </div>
                      </div>

                      <div
                        v-if="engErrors.length"
                        class="eng-card eng-card--error"
                      >
                        <div class="eng-card__head">
                          <span class="eng-card__label">Visitor Errors</span>
                        </div>
                        <div
                          v-for="(err, ei) in engErrors"
                          :key="ei"
                          :class="{ 'eng-multi-item': ei > 0 }"
                        >
                          <div class="eng-kv">
                            <template v-if="err.data?.code"
                              ><span>Code</span
                              ><span>{{ err.data.code }}</span></template
                            >
                            <template v-if="err.data?.message"
                              ><span>Message</span
                              ><span>{{ err.data.message }}</span></template
                            >
                          </div>
                        </div>
                      </div>

                      <div v-if="engKeywords.length" class="eng-card">
                        <div class="eng-card__head">
                          <span class="eng-card__label">Searched Content</span>
                        </div>
                        <div class="eng-tags">
                          <span
                            v-for="kw in engKeywords"
                            :key="kw"
                            class="eng-tag"
                            >{{ kw }}</span
                          >
                        </div>
                      </div>
                    </template>
                  </template>

                  <!-- ── Conversation Timeline ── -->
                  <div v-if="timeline.length" class="cust-section">
                    <div class="cust-section__title">Conversation Timeline</div>
                    <div class="conv-timeline">
                      <div
                        v-for="(seg, idx) in timeline"
                        :key="idx"
                        class="conv-timeline__seg"
                      >
                        <div class="conv-timeline__rail">
                          <!-- Skill icon -->
                          <div
                            class="conv-timeline__skill-icon"
                            :title="seg.skillName ?? ''"
                          >
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                            >
                              <path
                                d="M2 20h20M6 20V10l6-6 6 6v10M10 20v-5h4v5"
                              />
                            </svg>
                          </div>
                          <div class="conv-timeline__line" />
                          <!-- Agent icon with active pulse -->
                          <div class="conv-timeline__agent-icon-wrap">
                            <div
                              class="conv-timeline__agent-icon"
                              :class="[
                                seg.agentType === 'Human'
                                  ? 'conv-timeline__agent-icon--human'
                                  : 'conv-timeline__agent-icon--bot',
                                seg.isActive
                                  ? 'conv-timeline__agent-icon--active'
                                  : '',
                              ]"
                              :title="seg.agentName ?? ''"
                            >
                              <!-- Human icon -->
                              <svg
                                v-if="seg.agentType === 'Human'"
                                width="10"
                                height="10"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2.5"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                              >
                                <circle cx="12" cy="8" r="4" />
                                <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
                              </svg>
                              <!-- Bot icon -->
                              <svg
                                v-else
                                width="10"
                                height="10"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2.5"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                              >
                                <rect
                                  x="3"
                                  y="11"
                                  width="18"
                                  height="10"
                                  rx="2"
                                />
                                <path d="M12 11V7" />
                                <circle cx="12" cy="5" r="2" />
                                <path d="M8 15h.01M16 15h.01" />
                              </svg>
                            </div>
                            <div
                              v-if="seg.isActive"
                              class="conv-timeline__pulse"
                            />
                          </div>
                          <div
                            v-if="idx < timeline.length - 1"
                            class="conv-timeline__line conv-timeline__line--tail"
                          />
                        </div>
                        <div class="conv-timeline__body">
                          <!-- Skill row -->
                          <div class="conv-timeline__skill-row">
                            <span class="conv-timeline__skill-name">{{
                              seg.skillName ?? "Unknown skill"
                            }}</span>
                            <span class="conv-timeline__time">{{
                              new Date(seg.startTimeL).toLocaleString([], {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            }}</span>
                          </div>
                          <!-- Agent row -->
                          <div class="conv-timeline__agent-row">
                            <span
                              class="conv-timeline__agent-badge"
                              :class="
                                seg.agentType === 'Human'
                                  ? 'badge--human'
                                  : 'badge--bot'
                              "
                            >
                              {{ seg.agentType === "Human" ? "Human" : "Bot" }}
                            </span>
                            <span class="conv-timeline__agent-name">{{
                              seg.agentName ?? "—"
                            }}</span>
                            <span
                              v-if="seg.isActive"
                              class="conv-timeline__active-label"
                              >Active</span
                            >
                          </div>
                          <!-- Summary (collapsed by default) -->
                          <div
                            v-if="seg.summary"
                            class="conv-timeline__summary-wrap"
                          >
                            <button
                              class="conv-timeline__summary-toggle"
                              @click="toggleSummary(idx)"
                            >
                              <svg
                                width="10"
                                height="10"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2.5"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                :style="
                                  expandedSummaries.has(idx)
                                    ? 'transform:rotate(90deg)'
                                    : ''
                                "
                              >
                                <polyline points="9 18 15 12 9 6" />
                              </svg>
                              Summary
                            </button>
                            <div
                              v-if="expandedSummaries.has(idx)"
                              class="conv-timeline__summary"
                            >
                              {{ seg.summary }}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </template>
              </div>

              <!-- ── Notes ── -->
              <div
                data-panel="notes"
                tabindex="-1"
                class="panel-col"
                style="
                  padding: 1rem;
                  display: flex;
                  flex-direction: column;
                  gap: 0.75rem;
                "
              >
                <div class="text-xs" style="color: var(--text3)">
                  Your note is saved on the conversation (visible to other
                  agents).
                </div>
                <textarea
                  v-model="noteDraft"
                  placeholder="Add a note for this conversation…"
                  class="w-full h-28 rounded-lg px-3 py-2 text-sm outline-none resize-none"
                  style="
                    background: var(--surf-input);
                    border: 1px solid var(--border);
                    color: var(--text);
                  "
                ></textarea>
                <button
                  class="self-start px-4 py-2 rounded-lg text-sm font-medium hover:brightness-110 transition disabled:opacity-40 text-white"
                  style="background: var(--acc-grad)"
                  :disabled="savingNote"
                  @click="saveNote"
                >
                  {{ savingNote ? "Saving…" : "Save note" }}
                </button>

                <div
                  v-if="notes.length"
                  class="flex-1 overflow-y-auto space-y-2 mt-1"
                >
                  <div
                    class="text-[11px] uppercase tracking-wider"
                    style="color: var(--text3)"
                  >
                    All notes
                  </div>
                  <div
                    v-for="n in notes"
                    :key="n.noteId"
                    class="rounded-lg p-3 text-xs"
                    style="
                      background: rgba(255, 255, 255, 0.03);
                      border: 1px solid var(--border2);
                    "
                  >
                    <div class="flex items-center justify-between mb-1">
                      <span class="font-semibold" style="color: var(--text2)">
                        {{ n.name || n.agentId
                        }}<span
                          v-if="n.isAutoSummary"
                          style="color: var(--acc)"
                        >
                          · auto-summary</span
                        >
                      </span>
                      <span style="color: var(--text3)">{{
                        relTime(n.time)
                      }}</span>
                    </div>
                    <div
                      class="whitespace-pre-wrap break-words"
                      style="color: var(--text2)"
                    >
                      {{ n.noteContent }}
                    </div>
                  </div>
                </div>
              </div>

              <!-- ── Predefined content (canned) ── -->
              <div
                data-panel="pdc"
                tabindex="-1"
                class="panel-col"
                style="display: flex; flex-direction: column"
              >
                <div
                  class="p-3"
                  style="border-bottom: 1px solid var(--border2)"
                >
                  <input
                    v-model="pdcSearch"
                    placeholder="Search canned responses…"
                    class="w-full rounded-lg px-3 py-2 text-sm outline-none"
                    style="
                      background: var(--surf-input);
                      border: 1px solid var(--border);
                      color: var(--text);
                    "
                  />
                </div>
                <div class="flex-1 overflow-y-auto p-3 space-y-4">
                  <div
                    v-if="pdcLoading"
                    class="text-sm animate-pulse"
                    style="color: var(--text3)"
                  >
                    Loading…
                  </div>
                  <div
                    v-else-if="!pdcFiltered.length"
                    class="text-sm"
                    style="color: var(--text3)"
                  >
                    No canned responses.
                  </div>
                  <div v-for="cat in pdcFiltered" :key="cat.id">
                    <div class="pdc-cat-header">
                      <span class="pdc-cat-name">{{ cat.name }}</span>
                      <span class="pdc-cat-count">{{ cat.items.length }}</span>
                    </div>
                    <div class="space-y-1.5">
                      <button
                        v-for="p in cat.items"
                        :key="p.id"
                        class="w-full text-left rounded-lg p-3 transition hover:brightness-110"
                        style="
                          background: rgba(255, 255, 255, 0.03);
                          border: 1px solid var(--border2);
                        "
                        @click="usePdc(p)"
                      >
                        <div
                          class="text-sm font-semibold flex items-center justify-between gap-2 min-w-0"
                          style="color: var(--text)"
                        >
                          <span class="truncate">{{ p.title }}</span>
                          <span
                            v-if="p.hotkey?.prefix || p.hotkey?.suffix"
                            class="badge badge--muted font-mono"
                          >
                            {{ p.hotkey?.prefix }}→{{ p.hotkey?.suffix }}
                          </span>
                        </div>
                        <div
                          v-if="p.text"
                          class="text-xs mt-1 line-clamp-1"
                          style="color: var(--text3)"
                        >
                          {{ p.text }}
                        </div>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- ── Secure forms ── -->
              <div
                data-panel="forms"
                tabindex="-1"
                class="panel-col"
                style="padding: 1rem"
              >
                <div
                  v-if="formsLoading"
                  class="text-sm animate-pulse"
                  style="color: var(--text3)"
                >
                  Loading…
                </div>
                <div
                  v-else-if="!forms.length"
                  class="text-sm"
                  style="color: var(--text3)"
                >
                  No secure forms configured for this skill.
                </div>
                <div
                  v-for="f in forms"
                  :key="f.id"
                  class="rounded-xl p-3 transition cursor-pointer hover:brightness-110"
                  style="
                    background: rgba(255, 255, 255, 0.03);
                    border: 1px solid var(--border);
                  "
                  @click="sendForm(f)"
                >
                  <div class="flex items-center justify-between gap-2">
                    <span
                      class="text-sm font-medium"
                      style="color: var(--text)"
                      >{{ f.name }}</span
                    >
                    <button class="secform-btn" :disabled="sendingForm">
                      <Icon name="lock" :size="12" /> Send
                    </button>
                  </div>
                  <div
                    class="text-[11px] mt-1 flex flex-wrap gap-1.5"
                    style="color: var(--text3)"
                  >
                    <span
                      v-for="field in f.json"
                      :key="field.id"
                      class="badge badge--muted"
                    >
                      {{ field.name }}<span v-if="field.masked"> · masked</span>
                    </span>
                  </div>
                </div>
              </div>

              <!-- ── Pages (visitor nav history) ── -->
              <div
                data-panel="pages"
                tabindex="-1"
                class="panel-col"
                style="padding: 1rem"
              >
                <div
                  v-if="pagesLoading"
                  class="text-sm animate-pulse"
                  style="color: var(--text3)"
                >
                  Loading…
                </div>
                <div
                  v-else-if="!pages.length"
                  class="text-sm"
                  style="color: var(--text3)"
                >
                  No page-view history for this visitor.
                </div>
                <ol
                  v-else
                  class="relative ml-2 space-y-3"
                  style="border-left: 1px solid var(--border)"
                >
                  <li v-for="(p, i) in pages" :key="i" class="ml-4">
                    <span
                      class="absolute -left-[5px] mt-1.5 size-2 rounded-full"
                      style="background: var(--acc)"
                    ></span>
                    <a
                      :href="p.page"
                      target="_blank"
                      rel="noopener"
                      class="text-sm break-words transition"
                      style="color: var(--text2)"
                    >
                      {{ p.title || hostOf(p.page) }}
                    </a>
                    <div
                      class="text-[11px] break-all"
                      style="color: var(--text3)"
                    >
                      {{ hostOf(p.page) }}
                    </div>
                    <div
                      class="text-[11px] flex items-center gap-2 mt-0.5"
                      style="color: var(--text3)"
                    >
                      <span>{{ pageTime(p.visitTime) }}</span>
                      <span v-if="p.referrer" class="truncate"
                        >← {{ hostOf(p.referrer) }}</span
                      >
                    </div>
                  </li>
                </ol>
              </div>

              <!-- ── Cobrowse / video / voice ── -->
              <div
                data-panel="cobrowse"
                tabindex="-1"
                class="panel-col"
                style="display: flex; flex-direction: column"
                :class="{
                  'panel-col--fullwidth':
                    activeCobrowse && activeCobrowse.phase !== 'ended',
                }"
              >
                <template v-if="activeCobrowse">
                  <!-- Cobrowse status header -->
                  <div
                    class="px-5 py-3 border-b border-white/5 flex items-center justify-between"
                  >
                    <div class="flex items-center gap-2.5">
                      <span
                        class="size-2 rounded-full"
                        :class="{
                          'bg-emerald-400': activeCobrowse.phase === 'active',
                          'bg-amber-400 pulse-dot': [
                            'connecting',
                            'inviting',
                            'awaiting-accept',
                          ].includes(activeCobrowse.phase),
                          'bg-rose-500': activeCobrowse.phase === 'error',
                          'bg-slate-500': activeCobrowse.phase === 'ended',
                        }"
                      ></span>
                      <div>
                        <div
                          class="text-sm font-medium flex items-center gap-1.5"
                        >
                          <Icon name="monitor" :size="14" />
                          {{ cobrowseModeLabel(activeCobrowse.mode) }}
                        </div>
                        <div class="text-xs" style="color: var(--text3)">
                          {{ cobrowsePhaseLabel(activeCobrowse.phase) }}
                        </div>
                      </div>
                    </div>
                    <button
                      class="action"
                      title="End cobrowse"
                      @click="stopCobrowse(active.conversationId)"
                    >
                      <Icon name="ban" :size="14" /> End
                    </button>
                  </div>

                  <!-- Active: the cobrowse room is proxied through our server (same-origin
                 /api/cobrowse/:key/room), so it embeds in an iframe without the LE
                 session the cross-origin cobrowse host would otherwise demand. -->
                  <div
                    v-if="
                      activeCobrowse.phase === 'active' &&
                      activeCobrowse.roomUrl
                    "
                    class="flex-1 min-h-0 relative"
                  >
                    <iframe
                      :src="activeCobrowse.roomUrl"
                      class="w-full h-full border-0 bg-white"
                      allow="
                        camera;
                        microphone;
                        display-capture;
                        clipboard-read;
                        clipboard-write;
                      "
                    ></iframe>
                    <a
                      :href="activeCobrowse.roomUrl"
                      target="_blank"
                      rel="noopener"
                      class="absolute top-2 right-2 action !bg-black/60 backdrop-blur"
                      title="Open cobrowse room in a new tab"
                    >
                      <Icon name="monitor" :size="13" /> Pop out
                    </a>
                  </div>

                  <!-- Waiting / connecting state -->
                  <div v-else class="flex-1 grid place-items-center p-8">
                    <div class="text-center max-w-sm">
                      <div
                        v-if="activeCobrowse.phase !== 'error'"
                        class="mx-auto mb-4 size-12 rounded-full border-2 animate-spin"
                        style="
                          border-color: var(--acc-border);
                          border-top-color: var(--acc);
                        "
                      ></div>
                      <Icon
                        v-else
                        name="ban"
                        :size="40"
                        class="mx-auto mb-4 text-rose-400"
                      />
                      <div class="text-sm font-medium mb-1">
                        {{ cobrowsePhaseLabel(activeCobrowse.phase) }}
                      </div>
                      <p
                        v-if="activeCobrowse.phase === 'awaiting-accept'"
                        class="text-xs"
                        style="color: var(--text3)"
                      >
                        The customer has received a cobrowse invitation in their
                        messaging window. The session opens here once they
                        accept.
                      </p>
                      <p
                        v-if="activeCobrowse.error"
                        class="text-xs text-rose-300 mt-2"
                      >
                        {{ activeCobrowse.error }}
                      </p>
                      <button
                        v-if="['error', 'ended'].includes(activeCobrowse.phase)"
                        class="action mt-4 mx-auto"
                        @click="
                          stopCobrowse(active.conversationId);
                          startCobrowse();
                        "
                      >
                        Retry
                      </button>
                    </div>
                  </div>

                  <!-- Event log -->
                  <div
                    class="px-4 py-2 border-t border-white/5 text-[11px] font-mono text-slate-500 max-h-24 overflow-y-auto"
                  >
                    <div v-for="(l, i) in activeCobrowse.log" :key="i">
                      {{ l }}
                    </div>
                  </div>
                </template>

                <!-- No session yet: choose cobrowse / video / voice -->
                <div v-else class="flex-1 grid place-items-center p-8">
                  <div class="text-center max-w-xs">
                    <Icon
                      name="monitor"
                      :size="40"
                      class="mx-auto mb-4"
                      style="color: var(--text3)"
                    />
                    <div
                      class="text-sm font-medium mb-1"
                      style="color: var(--text)"
                    >
                      Cobrowse &amp; calls
                    </div>
                    <p class="text-xs mb-4" style="color: var(--text3)">
                      Invite the customer to share their screen, or start a
                      voice/video call. They accept in their messaging window.
                    </p>
                    <div class="flex flex-col gap-2">
                      <button
                        class="cobrowse-start"
                        @click="startCobrowse('cobrowse')"
                      >
                        <Icon name="monitor" :size="15" /> Start cobrowse
                        (screen share)
                      </button>
                      <button
                        class="cobrowse-start cobrowse-start--alt"
                        @click="startCobrowse('video-call')"
                      >
                        <Icon name="monitor" :size="15" /> Start video call
                      </button>
                      <button
                        class="cobrowse-start cobrowse-start--alt"
                        @click="startCobrowse('voice-call')"
                      >
                        <Icon name="chat" :size="15" /> Start voice call
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              <!-- /cobrowse panel -->
            </div>
            <!-- /inner row -->
          </div>
          <!-- /scroll container -->
        </section>

        <div
          v-if="!active"
          class="flex-1 grid place-items-center"
          style="color: var(--text3)"
        >
          Select a conversation
        </div>
      </main>
    </div>

    <input
      ref="fileInput"
      type="file"
      class="hidden"
      :accept="FILE_ACCEPT"
      @change="onFile"
    />

    <!-- Conversation context menu (right-click on a list row) -->
    <Teleport to="body">
      <div
        v-if="ctxMenu"
        class="ctx-menu fixed z-40 w-52"
        :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
        @click.stop
      >
        <button
          class="ctx-item ctx-item--danger"
          @click="endConversation(ctxMenu.id)"
        >
          <Icon name="ban" :size="15" /><span class="flex-1 text-left"
            >End conversation</span
          >
        </button>
        <button class="ctx-item" @click="backToQueue(ctxMenu.id)">
          <Icon name="undo" :size="15" style="color: #f97316" /><span
            class="flex-1 text-left"
            >Back to queue</span
          >
        </button>

        <!-- Transfer → opens dialog -->
        <button class="ctx-item" @click="openTransferDialog(ctxMenu!.id)">
          <Icon name="transfer" :size="15" style="color: var(--acc)" /><span
            class="flex-1 text-left"
            >Transfer conversation</span
          >
          <Icon name="chevron-right" :size="14" style="color: var(--text3)" />
        </button>

        <div class="ctx-sep"></div>
        <button class="ctx-item" @click="openPrivateModal(ctxMenu.id)">
          <Icon name="lock" :size="15" style="color: var(--text2)" /><span
            class="flex-1 text-left"
            >Send private message</span
          >
        </button>
      </div>
    </Teleport>

    <!-- Transfer conversation dialog -->
    <Transition name="msg">
      <div
        v-if="transferDialog"
        class="fixed inset-0 z-50 grid place-items-center bg-black/50"
        @click.self="transferDialog = null"
      >
        <div
          class="rounded-2xl shadow-2xl"
          style="
            width: 440px;
            height: 70vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
          "
        >
          <!-- Header — solid -->
          <div
            class="flex items-center justify-between px-5 py-4 flex-shrink-0"
            style="
              background: var(--bg1);
              border-bottom: 1px solid var(--border2);
              border-radius: 16px 16px 0 0;
            "
          >
            <span class="text-sm font-semibold" style="color: var(--text)"
              >Transfer conversation</span
            >
            <button class="cmp-btn" @click="transferDialog = null">
              <Icon name="x" :size="14" />
            </button>
          </div>

          <!-- Tabs + search — solid, part of header zone -->
          <div
            class="flex-shrink-0 px-4 pt-3 pb-2"
            style="
              background: var(--bg1);
              border-bottom: 1px solid var(--border2);
            "
          >
            <div class="flex gap-1 mb-3">
              <button
                v-for="t in ['skill', 'agent', 'manager'] as const"
                :key="t"
                class="px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition"
                :style="
                  transferTab === t
                    ? 'background:var(--acc-tint);color:var(--acc);border:1px solid var(--acc-border);'
                    : 'background:transparent;color:var(--text2);border:1px solid transparent;'
                "
                @click="
                  transferTab = t;
                  transferSelected = null;
                  transferSearch = '';
                "
              >
                {{ t }}
              </button>
            </div>
            <input
              v-model="transferSearch"
              :placeholder="`Search ${transferTab}s…`"
              class="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style="
                background: var(--surf-input);
                border: 1px solid var(--border);
                color: var(--text);
              "
            />
          </div>

          <!-- Scrollable list -->
          <div
            class="overflow-y-auto flex-1 px-4 py-2"
            style="background: var(--bg2); min-height: 0"
          >
            <!-- Skills -->
            <template v-if="transferTab === 'skill'">
              <div
                v-if="!filteredSkills.length"
                class="py-8 text-center text-xs"
                style="color: var(--text3)"
              >
                No skills found
              </div>
              <button
                v-for="s in filteredSkills"
                :key="s.id"
                class="trn-row"
                :class="transferSelected === s.id ? 'trn-row--on' : ''"
                @click="transferSelected = s.id"
              >
                <span class="truncate flex-1 text-left">{{ s.name }}</span>
                <Icon
                  v-if="transferSelected === s.id"
                  name="check"
                  :size="13"
                  style="color: var(--acc); flex-shrink: 0"
                />
              </button>
            </template>
            <!-- Agents -->
            <template v-else-if="transferTab === 'agent'">
              <div
                v-if="agentsLoading"
                class="py-8 text-center text-xs animate-pulse"
                style="color: var(--text3)"
              >
                Loading agents…
              </div>
              <div
                v-else-if="!filteredAgents.length"
                class="py-8 text-center text-xs"
                style="color: var(--text3)"
              >
                No agents found
              </div>
              <button
                v-for="a in filteredAgents"
                :key="a.id"
                class="trn-row"
                :class="transferSelected === a.id ? 'trn-row--on' : ''"
                @click="transferSelected = a.id"
              >
                <span class="trn-status" :class="`trn-status--${a.status.toLowerCase()}`" />
                <Icon
                  :name="a.isBot ? 'cpu' : 'user'"
                  :size="14"
                  style="color: var(--text3); flex-shrink: 0"
                />
                <div class="flex-1 min-w-0 text-left">
                  <div class="text-sm truncate" style="color: var(--text)">
                    {{ a.displayName }}
                  </div>
                  <div class="text-xs truncate" style="color: var(--text3)">
                    {{ a.loginName }}
                  </div>
                </div>
                <span
                  v-if="a.skills.length"
                  class="trn-skill"
                  :title="a.skills.map((s) => s.name).join(', ')"
                >
                  {{ a.skills.length === 1 ? a.skills[0].name : `${a.skills.length} skills` }}
                </span>
                <Icon
                  v-if="transferSelected === a.id"
                  name="check"
                  :size="13"
                  style="color: var(--acc); flex-shrink: 0"
                />
              </button>
            </template>
            <!-- Managers -->
            <template v-else>
              <div
                v-if="agentsLoading"
                class="py-8 text-center text-xs animate-pulse"
                style="color: var(--text3)"
              >
                Loading managers…
              </div>
              <div
                v-else-if="!filteredManagers.length"
                class="py-8 text-center text-xs"
                style="color: var(--text3)"
              >
                No managers found
              </div>
              <button
                v-for="m in filteredManagers"
                :key="m.id"
                class="trn-row"
                :class="transferSelected === m.id ? 'trn-row--on' : ''"
                @click="transferSelected = m.id"
              >
                <span class="trn-status" :class="`trn-status--${m.status.toLowerCase()}`" />
                <Icon
                  :name="m.isBot ? 'cpu' : 'user'"
                  :size="14"
                  style="color: var(--text3); flex-shrink: 0"
                />
                <div class="flex-1 min-w-0 text-left">
                  <div class="text-sm truncate" style="color: var(--text)">
                    {{ m.displayName }}
                  </div>
                  <div class="text-xs truncate" style="color: var(--text3)">
                    {{ m.loginName }}
                  </div>
                </div>
                <span
                  v-if="m.skills.length"
                  class="trn-skill"
                  :title="m.skills.map((s) => s.name).join(', ')"
                >
                  {{ m.skills.length === 1 ? m.skills[0].name : `${m.skills.length} skills` }}
                </span>
                <Icon
                  v-if="transferSelected === m.id"
                  name="check"
                  :size="13"
                  style="color: var(--acc); flex-shrink: 0"
                />
              </button>
            </template>
          </div>

          <!-- Footer — solid -->
          <div
            class="flex items-center justify-between px-5 py-4 flex-shrink-0"
            style="
              background: var(--bg1);
              border-top: 1px solid var(--border2);
              border-radius: 0 0 16px 16px;
            "
          >
            <span class="text-xs" style="color: var(--text3)">
              {{
                transferSelected
                  ? transferTab === "skill"
                    ? filteredSkills.find((s) => s.id === transferSelected)
                        ?.name
                    : [...filteredAgents, ...filteredManagers].find(
                        (a) => a.id === transferSelected,
                      )?.displayName
                  : `No ${transferTab} selected`
              }}
            </span>
            <div class="flex gap-2">
              <button class="action" @click="transferDialog = null">
                Cancel
              </button>
              <button
                class="px-4 py-2 rounded-lg text-sm font-medium text-white transition disabled:opacity-40"
                style="
                  background: var(--acc-grad);
                  border: none;
                  cursor: pointer;
                "
                :disabled="!transferSelected || transferring"
                @click="doTransfer"
              >
                {{ transferring ? "Transferring…" : "Transfer" }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Private message modal -->
    <Transition name="msg">
      <div
        v-if="privateModal"
        class="fixed inset-0 z-50 grid place-items-center bg-black/40"
        @click.self="privateModal = null"
      >
        <div class="modal-card rounded-2xl p-5 w-[420px] shadow-2xl">
          <div class="text-sm font-semibold mb-1">
            Private message (agent-only)
          </div>
          <div class="text-xs mb-3" style="color: var(--text3)">
            Not visible to the customer — internal note to other agents/managers
            on this conversation.
          </div>
          <textarea
            v-model="privateDraft"
            rows="3"
            placeholder="Type a private note…"
            class="w-full rounded-lg px-3 py-2 text-sm outline-none resize-none"
            style="
              background: var(--surf-input);
              border: 1px solid var(--border);
              color: var(--text);
            "
            @keydown.enter.exact.prevent="sendPrivate"
          ></textarea>
          <div class="flex justify-end gap-2 mt-3">
            <button class="action" @click="privateModal = null">Cancel</button>
            <button
              class="px-4 py-2 rounded-lg text-sm font-medium text-white hover:brightness-110 transition disabled:opacity-40"
              style="background: var(--acc-grad)"
              :disabled="!privateDraft.trim()"
              @click="sendPrivate"
            >
              Send private
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Secure-form picker -->
    <Transition name="msg">
      <div
        v-if="formPicker"
        class="fixed inset-0 z-50 grid place-items-center bg-black/40"
        @click.self="formPicker = false"
      >
        <div
          class="modal-card rounded-2xl p-5 w-[440px] max-h-[80vh] overflow-y-auto shadow-2xl"
          style="position: relative"
        >
          <!-- Close X -->
          <button
            class="cmp-btn"
            style="position: absolute; top: 12px; right: 12px"
            title="Close"
            @click="formPicker = false"
          >
            <Icon name="x" :size="14" />
          </button>

          <div class="flex items-center gap-2 mb-1">
            <Icon name="lock" :size="15" style="color: var(--acc)" />
            <span class="text-sm font-semibold" style="color: var(--text)"
              >Send a secure form</span
            >
          </div>
          <div class="text-xs mb-3" style="color: var(--text2)">
            PCI-compliant — the customer fills it in; you only ever see masked
            data.
          </div>

          <div
            v-if="formsLoading"
            class="py-8 text-center text-sm animate-pulse"
            style="color: var(--text2)"
          >
            Loading forms…
          </div>
          <div
            v-else-if="!forms.length"
            class="py-8 text-center text-sm"
            style="color: var(--text2)"
          >
            No secure forms configured for this skill.
          </div>
          <ul v-else class="space-y-2">
            <li
              v-for="f in forms"
              :key="f.id"
              class="modal-item rounded-xl p-3 transition"
              style="cursor: default"
            >
              <div
                class="text-sm font-medium mb-1.5"
                style="color: var(--text)"
              >
                {{ f.name }}
              </div>
              <div class="flex items-end justify-between gap-2">
                <div
                  class="text-[11px] flex flex-wrap gap-1.5"
                  style="color: var(--text2)"
                >
                  <span
                    v-for="field in f.json"
                    :key="field.id"
                    class="badge badge--muted"
                  >
                    {{ field.name }}<span v-if="field.masked"> · masked</span>
                  </span>
                </div>
                <button
                  class="secform-btn"
                  style="flex-shrink: 0"
                  :disabled="sendingForm"
                  @click.stop="sendForm(f)"
                >
                  <Icon name="lock" :size="12" /> Send
                </button>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </Transition>

    <!-- Secure-form submission viewer -->
    <Transition name="msg">
      <div
        v-if="formView"
        class="fixed inset-0 z-50 grid place-items-center bg-black/40"
        @click.self="formView = null"
      >
        <div
          class="glass rounded-2xl p-5 w-[480px] max-h-[80vh] overflow-y-auto border border-white/10 shadow-2xl"
        >
          <div class="flex items-center gap-2 mb-1">
            <Icon name="lock" :size="15" style="color: var(--acc)" />
            <span class="text-sm font-semibold" style="color: var(--text)"
              >{{ formView.title }} · submission</span
            >
          </div>
          <div class="text-xs mb-3" style="color: var(--text3)">
            One-time read token issued. Values are masked by LP per the form
            config.
          </div>

          <!-- Structured masked data if the read endpoint returned it -->
          <dl
            v-if="
              formView.result.data && typeof formView.result.data === 'object'
            "
            class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm"
          >
            <template
              v-for="(val, key) in formView.result.data as Record<
                string,
                unknown
              >"
              :key="key"
            >
              <dt class="whitespace-nowrap" style="color: var(--text3)">
                {{ key }}
              </dt>
              <dd class="break-words font-mono" style="color: var(--text)">
                {{ String(val) }}
              </dd>
            </template>
          </dl>

          <!-- Otherwise show the token + raw probe result (read endpoint not provisioned) -->
          <div v-else class="text-xs space-y-2">
            <div class="glass rounded-lg p-3">
              <div class="text-slate-500 mb-1">Read token (readOtk)</div>
              <div class="font-mono text-slate-300 break-all">
                {{ formView.result.readOtk }}
              </div>
            </div>
            <div
              v-if="formView.result.fetch"
              class="glass rounded-lg p-3 text-slate-400"
            >
              <div>
                Data endpoint →
                {{
                  formView.result.fetch.status ?? formView.result.fetch.error
                }}
              </div>
              <div
                v-if="formView.result.fetch.body"
                class="font-mono text-[11px] mt-1 break-all opacity-70"
              >
                {{ formView.result.fetch.body }}
              </div>
              <div class="text-slate-500 mt-1">
                The masked-data read endpoint is account-provisioned; the token
                + invitation flow above is the proven part.
              </div>
            </div>
          </div>

          <div class="flex justify-end mt-4">
            <button class="action" @click="formView = null">Close</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Toast -->
    <Transition name="msg">
      <div
        v-if="toast"
        class="fixed bottom-5 right-5 px-4 py-3 rounded-xl glass text-sm shadow-2xl border"
        :class="{
          'border-emerald-500/30 text-emerald-300': toast.kind === 'ok',
          'border-rose-500/30 text-rose-300': toast.kind === 'err',
        }"
        :style="
          toast.kind === 'info'
            ? 'border-color:var(--acc-border);color:#a78bfa;'
            : ''
        "
      >
        {{ toast.text }}
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.action {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.75rem;
  border-radius: 0.5rem;
  font-size: 0.75rem;
  background: rgba(20, 22, 31, 0.66);
  border: 1px solid rgba(255, 255, 255, 0.07);
  backdrop-filter: blur(14px);
  transition: background 0.2s;
}
.action:hover {
  background: rgba(255, 255, 255, 0.1);
}
.action--on {
  background: var(--acc-tint);
  border-color: var(--acc-border);
  color: #a78bfa;
}
.cobrowse-start {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 1.1rem;
  border-radius: 0.75rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: #fff;
  background: var(--acc-grad);
  transition: filter 0.2s;
}
.cobrowse-start:hover {
  filter: brightness(1.1);
}
.cobrowse-start {
  justify-content: center;
}
.cobrowse-start--alt {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #cbd5e1;
}
.cobrowse-start--alt:hover {
  background: rgba(255, 255, 255, 0.12);
  filter: none;
}

/* Conversation list badges */
.badge {
  display: inline-flex;
  align-items: center;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  padding: 3px 7px;
  border-radius: 9999px;
  border: 1px solid transparent;
  white-space: nowrap;
}
.badge--skill {
  background: var(--acc-tint);
  color: var(--acc);
  border-color: var(--acc-border);
}
.badge--active {
  background: rgba(16, 185, 129, 0.15);
  color: #059669;
}
.badge--idle {
  background: rgba(100, 116, 139, 0.12);
  color: var(--text2);
}
.badge--urgent {
  background: rgba(245, 158, 11, 0.15);
  color: #b45309;
}
.badge--queued {
  background: rgba(249, 115, 22, 0.15);
  color: #c2410c;
  border-color: rgba(249, 115, 22, 0.25);
}
.badge--overdue {
  background: rgba(244, 63, 94, 0.15);
  color: #be123c;
  border-color: rgba(244, 63, 94, 0.3);
}
.badge--muted {
  background: var(--badge-bg);
  color: var(--text3);
}

/* Slightly-rounded chips/badges (no longer full pills) */
.badge {
  border-radius: 6px;
}

/* CCUI status bar buttons — icon + count, only slightly rounded */
/* Right-panel tabs */
.paneltab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 500;
  color: #94a3b8;
  white-space: nowrap;
  transition: all 0.15s;
}
.paneltab:hover {
  background: rgba(255, 255, 255, 0.05);
  color: #e2e8f0;
}
.paneltab--on {
  background: var(--acc-tint);
  color: #a78bfa;
  border: 1px solid var(--acc-border);
}
.panel-col {
  flex: 0 0 400px;
  width: 400px;
  height: 100%;
  border: 1px solid var(--border2);
  border-radius: 10px;
  outline: none;
  box-sizing: border-box;
  overflow-y: auto;
  overflow-x: hidden;
  background: rgba(26, 21, 53, 0.55);
  backdrop-filter: blur(18px) saturate(1.4);
  -webkit-backdrop-filter: blur(18px) saturate(1.4);
}
[data-theme="light"] .panel-col {
  background: #ffffff;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.panel-col--fullwidth {
  flex: 0 0 100% !important;
  width: 100% !important;
}
.panel-strip--cobrowse-full .panel-col:not(.panel-col--fullwidth) {
  flex: 0 0 0 !important;
  width: 0 !important;
  overflow: hidden;
  padding: 0 !important;
  border: none !important;
}

.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.statbtn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 4px 6px;
  border-radius: 6px;
  color: #cbd5e1;
  background: transparent;
  border: 1px solid transparent;
  transition: all 0.15s;
}
.statbtn:hover {
  background: rgba(255, 255, 255, 0.06);
}
.statbtn--on {
  background: var(--acc-tint);
  border-color: var(--acc-border);
}
.statbtn-count {
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}
.statcount--overdue {
  color: #fda4af;
}
.statcount--urgent {
  color: #fcd34d;
}
.statcount--active {
  color: #6ee7b7;
}
.statcount--queued {
  color: #fdba74;
}
.statcount--idle {
  color: #94a3b8;
}

/* Context menu + filter dropdown */
/* Hotkey quick-content menu (anchored above the composer) */
.quick-menu {
  position: absolute;
  left: 1rem;
  right: 1rem;
  bottom: calc(100% - 0.5rem);
  max-height: 280px;
  overflow-y: auto;
  background: rgba(16, 18, 27, 0.97);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  backdrop-filter: blur(16px);
  box-shadow: 0 18px 40px -12px rgba(0, 0, 0, 0.7);
  z-index: 30;
}

.ctx-menu {
  background: var(--bg1);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 4px;
  backdrop-filter: var(--blur-md);
  box-shadow:
    0 18px 40px -12px rgba(0, 0, 0, 0.4),
    var(--shadow);
}
.ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 9px;
  border-radius: 6px;
  font-size: 12.5px;
  color: var(--text);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: background 0.12s;
}
.ctx-item:hover {
  background: var(--acc-tint);
}
.ctx-item--danger {
  color: #ef4444;
}
.ctx-item--danger:hover {
  background: rgba(239, 68, 68, 0.1);
}
.ctx-sep {
  height: 1px;
  margin: 4px 2px;
  background: var(--border2);
}

/* Automated conversation summary card */
.summary-card {
  padding: 14px 16px;
  border-radius: 14px;
  background: linear-gradient(
    180deg,
    var(--acc-tint),
    rgba(147, 51, 234, 0.04)
  );
  border: 1px solid var(--acc-border);
}

/* Customer info sections */
.cust-section {
  margin-bottom: 14px;
}
.cust-section__title {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--acc);
  padding: 0 4px 5px 4px;
  border-bottom: 1px solid var(--border2);
  margin-bottom: 6px;
}
.cust-section__dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 3px 10px;
}
.cust-dt {
  font-size: 11px;
  color: var(--text3);
  white-space: nowrap;
  padding: 2px 4px;
  align-self: baseline;
}
.cust-dd {
  font-size: 12px;
  color: var(--text);
  padding: 2px 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  align-self: baseline;
}

/* Conversation Timeline */
.conv-timeline {
  padding: 2px 0;
}
.conv-timeline__seg {
  display: flex;
  gap: 10px;
}

/* Rail column */
.conv-timeline__rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex-shrink: 0;
  width: 20px;
}
.conv-timeline__skill-icon {
  width: 20px;
  height: 20px;
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text3);
  flex-shrink: 0;
}
.conv-timeline__line {
  flex: 1;
  width: 2px;
  background: var(--border2);
  min-height: 8px;
}
.conv-timeline__line--tail {
  min-height: 14px;
}
.conv-timeline__agent-icon-wrap {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}
.conv-timeline__agent-icon {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--border2);
  background: var(--surf-panel);
  color: var(--text3);
  flex-shrink: 0;
  position: relative;
  z-index: 1;
}
.conv-timeline__agent-icon--human {
  border-color: var(--acc);
  background: color-mix(in srgb, var(--acc) 15%, transparent);
  color: var(--acc);
}
.conv-timeline__agent-icon--bot {
  border-color: var(--text3);
}
.conv-timeline__agent-icon--active {
  border-color: #22c55e;
  background: color-mix(in srgb, #22c55e 15%, transparent);
  color: #22c55e;
}
.conv-timeline__pulse {
  position: absolute;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(34, 197, 94, 0.3);
  animation: tl-pulse 1.8s ease-out infinite;
  z-index: 0;
}
@keyframes tl-pulse {
  0% {
    transform: scale(0.7);
    opacity: 0.8;
  }
  70% {
    transform: scale(1.4);
    opacity: 0;
  }
  100% {
    transform: scale(1.4);
    opacity: 0;
  }
}

/* Body column */
.conv-timeline__body {
  flex: 1;
  min-width: 0;
}
.conv-timeline__skill-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  min-height: 20px;
}
.conv-timeline__skill-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--text2);
}
.conv-timeline__time {
  font-size: 10px;
  color: var(--text3);
  white-space: nowrap;
  flex-shrink: 0;
}
.conv-timeline__agent-row {
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: 20px;
  margin-bottom: 6px;
}
.conv-timeline__agent-name {
  font-size: 12px;
  color: var(--text);
  font-weight: 500;
}
.conv-timeline__active-label {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #22c55e;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(34, 197, 94, 0.12);
  border: 1px solid rgba(34, 197, 94, 0.3);
}
.conv-timeline__agent-badge {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 1px 5px;
  border-radius: 4px;
  flex-shrink: 0;
}
.badge--human {
  background: color-mix(in srgb, var(--acc) 20%, transparent);
  color: var(--acc);
}
.badge--bot {
  background: rgba(255, 255, 255, 0.07);
  color: var(--text3);
}
.conv-timeline__summary-wrap {
  margin-bottom: 10px;
}
.conv-timeline__summary-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text3);
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 0;
  transition: color 0.15s;
}
.conv-timeline__summary-toggle:hover {
  color: var(--text2);
}
.conv-timeline__summary-toggle svg {
  transition: transform 0.15s;
  flex-shrink: 0;
}
.conv-timeline__summary {
  margin-top: 5px;
  font-size: 11px;
  color: var(--text3);
  line-height: 1.5;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--border2);
  border-radius: 6px;
  padding: 7px 9px;
  white-space: pre-wrap;
}

/* Engagement Attributes panel */
.eng-group-title {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--acc);
  margin: 14px 0 6px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border2);
}
.eng-group-title:first-child {
  margin-top: 0;
}
.eng-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border2);
  border-radius: 8px;
  padding: 8px 10px;
  margin-bottom: 6px;
}
.eng-card--purchase {
  border-color: rgba(34, 197, 94, 0.3);
}
.eng-card--error {
  border-color: rgba(239, 68, 68, 0.3);
}
.eng-card__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}
.eng-card__label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text2);
}
.eng-card__currency {
  font-size: 10px;
  color: var(--text3);
}
.eng-kv {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 1px 8px;
  font-size: 11px;
}
.eng-kv > span:nth-child(odd) {
  color: var(--text3);
  white-space: nowrap;
  padding: 2px 0;
}
.eng-kv > span:nth-child(even) {
  color: var(--text);
  padding: 2px 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.eng-products {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.eng-product {
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: rgba(0, 0, 0, 0.15);
  border-radius: 5px;
  padding: 5px 7px;
}
.eng-product__name {
  font-size: 11px;
  font-weight: 500;
  color: var(--text);
}
.eng-product__meta {
  font-size: 10px;
  color: var(--text3);
}
.eng-product__price {
  font-size: 10px;
  color: var(--acc);
}
.eng-multi-item {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border2);
}
.eng-purchase-order + .eng-purchase-order {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border2);
}
.eng-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 2px;
}
.eng-tag {
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text2);
  border: 1px solid var(--border2);
}

/* Canned response category header */
.pdc-cat-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 2px 5px;
  margin-bottom: 6px;
  position: sticky;
  top: 0;
  backdrop-filter: blur(12px);
  background: transparent;
}
.pdc-cat-name {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--acc);
}
.pdc-cat-count {
  font-size: 10px;
  font-weight: 500;
  color: var(--text3);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border2);
  border-radius: 8px;
  padding: 1px 6px;
  line-height: 1.4;
}
/* Canned item */
.pdc-item-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  letter-spacing: -0.01em;
}
.pdc-item-preview {
  font-size: 11px;
  color: var(--text3);
  margin-top: 2px;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* Transfer dialog rows */
.trn-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 9px 10px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  transition:
    background 0.1s,
    border-color 0.1s;
  margin-bottom: 2px;
  color: var(--text);
  font-size: 13px;
}
.trn-row:hover {
  background: var(--acc-tint);
}
.trn-row--on {
  background: var(--acc-tint);
  border-color: var(--acc-border);
}
.trn-status {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--text3);
}
.trn-status--online { background: #22c55e; }
.trn-status--occupied { background: #14b8a6; }
.trn-status--away { background: #f59e0b; }
.trn-status--back_soon { background: #3b82f6; }
.trn-status--offline { background: #94a3b8; }
.trn-tag {
  font-size: 10px;
  font-weight: 600;
  color: var(--text2);
  background: var(--badge-bg);
  border-radius: 5px;
  padding: 1px 6px;
  flex-shrink: 0;
}
.trn-skill {
  font-size: 10px;
  font-weight: 600;
  color: var(--acc);
  background: var(--acc-tint);
  border: 1px solid var(--acc-border);
  border-radius: 5px;
  padding: 1px 6px;
  flex-shrink: 0;
  max-width: 130px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Modal overlay cards */
.modal-card {
  background: var(--bg1);
  border: 1px solid var(--border);
  backdrop-filter: var(--blur-md);
}
.modal-item {
  background: var(--bg2);
  border: 1px solid var(--border2);
}
.modal-item:hover {
  border-color: var(--acc-border);
  background: var(--acc-tint);
}

/* Secure-form message card + button */
.secform-card {
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--bg1);
  border: 1px solid var(--border);
}
.secform-btn {
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
  transition:
    opacity 0.15s,
    transform 0.12s,
    box-shadow 0.15s;
  box-shadow: 0 2px 10px rgba(147, 51, 234, 0.3);
}
.secform-btn:hover:not(:disabled) {
  opacity: 0.88;
  box-shadow: 0 4px 16px rgba(147, 51, 234, 0.45);
  transform: translateY(-1px);
}
.secform-btn:active:not(:disabled) {
  transform: translateY(0);
}
.secform-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.summary-copy {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 6px;
  color: #a78bfa;
  background: var(--acc-tint);
  border: 1px solid var(--acc-border);
  transition: all 0.15s;
}
.summary-copy:hover {
  background: rgba(147, 51, 234, 0.2);
}

/* Composer toolbar buttons */
/* Auth menu */
.auth-menu {
  position: fixed;
  bottom: 56px;
  left: 8px;
  width: 240px;
  background: var(--bg1);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
  overflow: visible;
  z-index: 200;
}
.auth-menu__header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
}
.auth-menu__avatar {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  background: var(--acc-tint);
  color: var(--acc);
  border: 1px solid var(--acc-border);
}
.auth-menu__state-dot {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 10px;
  height: 10px;
  border-radius: 9999px;
  border: 2px solid var(--bg1);
}
.auth-menu__section {
  padding: 8px 12px;
}
.auth-menu__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.auth-menu__chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  border-radius: 9999px;
  font-size: 10px;
  font-weight: 600;
  background: var(--acc-tint);
  color: var(--acc);
  border: 1px solid var(--acc-border);
  white-space: nowrap;
}
.auth-menu__chip--overflow {
  background: var(--bg3);
  color: var(--text2);
  border-color: var(--border);
  cursor: default;
}
.auth-menu__overflow-list {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  background: var(--bg1);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 120px;
  max-width: 200px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  z-index: 210;
}
.auth-menu__state-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}
.auth-menu__state-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: transparent;
  font-size: 11px;
  color: var(--text2);
  cursor: pointer;
  transition:
    background 0.1s,
    color 0.1s;
  text-align: left;
}
.auth-menu__state-btn:hover:not(:disabled) {
  background: var(--acc-tint);
  color: var(--text);
}
.auth-menu__state-btn--on {
  background: var(--acc-tint);
  color: var(--text);
  border-color: var(--acc-border);
}
.auth-menu__state-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.auth-menu__state-pip {
  width: 7px;
  height: 7px;
  border-radius: 9999px;
  flex-shrink: 0;
}
.auth-menu__sep {
  height: 1px;
  background: var(--border2);
  margin: 0;
}
.auth-menu__item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 12px;
  color: var(--text2);
  transition:
    background 0.1s,
    color 0.1s;
  text-align: left;
}
.auth-menu__item:hover:not(:disabled) {
  background: var(--acc-tint);
  color: var(--text);
}
.auth-menu__item:disabled {
  opacity: 0.5;
  cursor: default;
}
.auth-menu__item--warn {
  color: #f59e0b;
}
.auth-menu__item--warn:hover:not(:disabled) {
  background: rgba(245, 158, 11, 0.1);
  color: #f59e0b;
}
.auth-menu__item--danger {
  color: #f87171;
}
.auth-menu__item--danger:hover {
  background: rgba(248, 113, 113, 0.1);
  color: #f87171;
}
.auth-menu__reason-flyout {
  position: fixed;
  /* aligned to auth menu: left edge = auth menu right (8px + 240px + 6px gap) */
  left: 260px;
  bottom: 56px;
  width: 200px;
  background: var(--bg1);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.45);
  overflow: hidden;
  z-index: 201;
}
.auth-menu__reason-flyout-title {
  padding: 8px 10px 4px;
  display: block;
}
.auth-menu__state-btn--pending {
  border-color: var(--acc-border);
  background: var(--acc-tint);
  color: var(--text);
}
.auth-menu__reason-search {
  display: block;
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  background: var(--surf-input);
  border: none;
  border-bottom: 1px solid var(--border2);
  color: var(--text);
  font-size: 11px;
  outline: none;
}
.auth-menu__reason-search::placeholder { color: var(--text3); }
.auth-menu__reason-list {
  max-height: 140px;
  overflow-y: auto;
}
.auth-menu__reason-item {
  display: block;
  width: 100%;
  padding: 6px 10px;
  background: transparent;
  border: none;
  text-align: left;
  font-size: 11px;
  color: var(--text2);
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}
.auth-menu__reason-item:hover { background: var(--acc-tint); color: var(--text); }
.auth-menu__reason-empty {
  padding: 8px 10px;
  font-size: 11px;
  color: var(--text3);
  font-style: italic;
}

/* Embedded button group — depressed trough with floating buttons inside */
.cmp-grp {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px 3px;
  border-radius: 8px;
  border: 1px solid var(--grp-border);
  background: var(--grp-bg);
  box-shadow: var(--grp-shadow);
  flex-shrink: 0;
}
.cmp-grp__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 22px;
  width: 24px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  cursor: pointer;
  color: var(--text3);
  transition:
    background 0.1s,
    color 0.1s,
    border-color 0.1s,
    box-shadow 0.1s;
  flex-shrink: 0;
}
.cmp-grp__btn:hover {
  background: var(--grp-btn-bg);
  border-color: var(--border);
  color: var(--text2);
  box-shadow: var(--grp-btn-shadow);
}
.cmp-grp__btn--on {
  background: var(--acc-tint);
  border-color: var(--acc-border);
  color: var(--acc);
  box-shadow: var(--grp-btn-shadow);
}

.cmp-btn {
  display: inline-flex;
  align-items: center;
  height: 26px;
  min-width: 26px;
  padding: 0 5px;
  border-radius: 5px;
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  color: var(--text2);
  transition: all 0.12s;
  flex-shrink: 0;
}
.cmp-btn:hover {
  background: rgba(128, 100, 200, 0.1);
  color: var(--text);
  border-color: var(--border2);
}
.cmp-ai {
  color: #a78bfa;
  background: var(--acc-tint);
  border-color: var(--acc-border);
}
.cmp-ai:hover {
  background: rgba(147, 51, 234, 0.2);
  color: #c4b8ff;
}
.cmp-btn-on {
  color: #a78bfa;
  background: var(--acc-tint);
  border-color: var(--acc-border);
}
.cmp-sep {
  width: 1px;
  height: 14px;
  background: var(--border2);
  margin: 0 3px;
  flex-shrink: 0;
}

/* Hover transcript tooltip */
.conv-tooltip {
  position: fixed;
  left: 308px;
  z-index: 200;
  width: 280px;
  padding: 10px 12px;
  background: var(--surf-comp);
  backdrop-filter: var(--blur-md);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow);
  pointer-events: none;
}
@keyframes tip-in {
  from {
    opacity: 0;
    transform: translateX(-4px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
.msg-enter-active {
  transition: all 0.28s cubic-bezier(0.2, 0.7, 0.2, 1);
}
.msg-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.msg-leave-active {
  transition: all 0.2s ease;
  position: absolute;
}
.msg-leave-to {
  opacity: 0;
}
/* ── Previous conversations ribbon ───────────────────────────────────────── */
.prev-conv-ribbon {
  position: relative;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border2);
}
.prev-conv-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 14px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text3);
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
  transition: color 0.15s, background 0.15s;
}
.prev-conv-toggle:hover { color: var(--text2); background: rgba(255,255,255,0.03); }
.prev-conv-toggle--open { color: var(--text2); }
.prev-conv-chevron {
  margin-left: auto;
  transition: transform 0.18s ease;
}
.prev-conv-toggle--open .prev-conv-chevron { transform: rotate(180deg); }

/* Dropdown */
.hist-drop {
  border-top: 1px solid var(--border2);
  background: var(--bg2);
  max-height: 320px;
  overflow-y: auto;
}
.hist-drop-enter-active, .hist-drop-leave-active {
  transition: max-height 0.2s ease, opacity 0.15s ease;
  overflow: hidden;
}
.hist-drop-enter-from, .hist-drop-leave-to { max-height: 0; opacity: 0; }
.hist-drop-enter-to, .hist-drop-leave-from { max-height: 320px; opacity: 1; }

/* Each past conversation row */
.hist-item { border-bottom: 1px solid var(--border2); }
.hist-item:last-child { border-bottom: none; }
.hist-item-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 14px;
  font-size: 12px;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--text2);
  text-align: left;
  transition: background 0.12s;
}
.hist-item-row:hover { background: var(--bg3); }
.hist-item-chevron { color: var(--text3); transition: transform 0.18s ease; flex-shrink: 0; }
.hist-item-chevron--open { transform: rotate(90deg); }
.hist-item-date { font-weight: 500; color: var(--text); white-space: nowrap; }
.hist-item-skill {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 9999px;
  background: var(--bg3);
  color: var(--text3);
  white-space: nowrap;
}
.hist-item-agent { font-size: 11px; color: var(--text3); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hist-item-count { font-size: 10px; color: var(--text3); margin-left: auto; white-space: nowrap; flex-shrink: 0; }

/* Expanded messages pane */
.hist-msgs {
  padding: 8px 14px 10px 30px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  border-top: 1px solid var(--border2);
  background: rgba(0,0,0,0.08);
}
.hist-msgs-enter-active, .hist-msgs-leave-active {
  transition: max-height 0.2s ease, opacity 0.15s ease;
  overflow: hidden;
}
.hist-msgs-enter-from, .hist-msgs-leave-to { max-height: 0; opacity: 0; }
.hist-msgs-enter-to, .hist-msgs-leave-from { max-height: 600px; opacity: 1; }
.hist-msgs-loading { font-size: 11px; color: var(--text3); padding: 4px 0; }
.hist-msg { display: flex; flex-direction: column; }
.hist-msg--consumer { align-items: flex-start; }
.hist-msg--agent { align-items: flex-end; }
.hist-msg-bubble {
  max-width: 75%;
  padding: 5px 9px;
  border-radius: 9px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--text);
  background: var(--bg3);
  word-break: break-word;
}
.hist-msg--agent .hist-msg-bubble { background: var(--acc-grad); color: #fff; }
.hist-msg-meta { font-size: 9px; color: var(--text3); margin-top: 2px; padding: 0 3px; }

.send-lang-badge {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 1px 5px;
  border-radius: 9999px;
  background: rgba(255,255,255,0.22);
  line-height: 1.4;
}
.msg-translate-toggle {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-top: 4px;
  padding: 0;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 10px;
  color: var(--text3);
  opacity: 0.7;
  transition: opacity 0.1s, color 0.1s;
}
.msg-translate-toggle:hover {
  opacity: 1;
  color: var(--acc);
}
</style>
