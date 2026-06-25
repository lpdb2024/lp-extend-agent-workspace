import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import {
  api,
  subscribeEvents,
  subscribeCobrowse,
  fileUrl,
  type Me,
  type Conversation,
  type ConvStatus,
  type ChatMessage,
  type SecureFormConfig,
  type SecureFormView,
  type AgentNote,
  type CannedResponse,
  type CannedCategory,
  type CustomerInfo,
  type PageView,
  type TimelineSegment,
  type Skill,
  type AgentUser,
  type LpPrompt,
  type ConvHistorySummary,
  type HistoryMessage,
  type AgentAvailState,
  type StatusReason,
} from '../lib/api';

export type Filter = 'all' | ConvStatus;
export type PanelTab = 'notes' | 'sdes' | 'pdc' | 'forms' | 'pages' | 'cobrowse';
export type CobrowseMode = 'cobrowse' | 'video-call' | 'voice-call';
export type CobrowsePhase =
  | 'connecting'
  | 'inviting'
  | 'awaiting-accept'
  | 'active'
  | 'ended'
  | 'error';
export interface CobrowseState {
  sessionKey: string;
  phase: CobrowsePhase;
  mode: CobrowseMode;
  roomUrl: string | null;
  callLink: string | null;
  error: string | null;
  log: string[];
  close: (() => void) | null;
}
export interface CustomerSection {
  title: string;
  rows: { label: string; value: string }[];
}

export type WorkspaceEmit = {
  (e: 'sign-out'): void;
  (e: 'toggle-theme'): void;
};

/**
 * The entire agent-console logic — state, SSE wiring, API calls, and helpers —
 * extracted verbatim from Workspace.vue so BOTH the full console and the compact
 * widget can consume it without duplicating a single line. The console keeps its
 * template + styles; the widget renders a compact template against the same store.
 */
export function useWorkspace(me: Me, emit: WorkspaceEmit) {
  const connected = ref(me.connected);
  const conversations = reactive<Conversation[]>([...me.conversations]);
  const messages = reactive<Record<string, ChatMessage[]>>({});
  const activeId = ref<string | null>(conversations[0]?.conversationId ?? null);
  const draft = ref('');
  const rewritePromptText = ref<string | null>(null);
  const rewriting = ref(false);

  // Live clock — ticks every second so SLA countdowns and relative times stay current.
  const now = ref(Date.now());
  let clock: ReturnType<typeof setInterval> | null = null;

  // Left-panel filter + search.
  const search = ref('');
  const filter = ref<Filter>('all');
  const filterMenuOpen = ref(false);

  // Cached transcripts per conversation.
  const transcripts = reactive<Record<string, ChatMessage[]>>({});
  const transcriptLoading = reactive<Record<string, boolean>>({});

  // Hover tooltip + right-click context menu state.
  const hoverId = ref<string | null>(null);
  const hoverY = ref(0);
  const ctxMenu = ref<{ id: string; x: number; y: number } | null>(null);
  const authMenuOpen = ref(false);
  const translateActive = ref(false);

  // ── Consumer history ──────────────────────────────────────────────────────
  const historyList = reactive<Record<string, ConvHistorySummary[]>>({});
  const historyLoading = reactive<Record<string, boolean>>({});
  /** Whether the history dropdown is open for the active conversation */
  const historyDropdownOpen = ref(false);
  /** Set of histIds whose messages are expanded in the dropdown */
  const historyExpanded = ref(new Set<string>());
  const historyMessages = reactive<Record<string, HistoryMessage[]>>({});
  const historyMessagesLoading = reactive<Record<string, boolean>>({});

  async function loadConsumerHistory(conversationId: string): Promise<void> {
    if (historyList[conversationId] !== undefined || historyLoading[conversationId]) return;
    historyLoading[conversationId] = true;
    try {
      const { history } = await api.getConsumerHistory(conversationId);
      historyList[conversationId] = history;
    } catch {
      historyList[conversationId] = [];
    } finally {
      historyLoading[conversationId] = false;
    }
  }

  async function toggleHistoryConv(activeConvId: string, histId: string): Promise<void> {
    const next = new Set(historyExpanded.value);
    if (next.has(histId)) {
      next.delete(histId);
      historyExpanded.value = next;
      return;
    }
    next.add(histId);
    historyExpanded.value = next;
    if (historyMessages[histId] !== undefined || historyMessagesLoading[histId]) return;
    historyMessagesLoading[histId] = true;
    try {
      const { messages } = await api.getHistoryMessages(activeConvId, histId);
      historyMessages[histId] = messages;
    } catch {
      historyMessages[histId] = [];
    } finally {
      historyMessagesLoading[histId] = false;
    }
  }

  function closeHistoryDropdown(): void {
    historyDropdownOpen.value = false;
    historyExpanded.value = new Set();
  }
  const translating = ref(false);
  const sendingTranslation = ref(false);
  /** cache: `${conversationId}:${sequence}` → translated text */
  const translationCache = reactive<Record<string, string>>({});
  /** which messages the user has toggled back to original */
  const showOriginal = reactive<Record<string, boolean>>({});
  /** customer browser language per conversationId, populated when customer info loads */
  const customerLangCache = reactive<Record<string, string>>({});

  function translationKey(conversationId: string, sequence: number) {
    return `${conversationId}:${sequence}`;
  }

  async function translateActiveConversation() {
    if (!activeId.value || translating.value) return;
    const convId = activeId.value;
    const msgs = messages[convId] ?? [];
    const toTranslate = msgs.filter(
      m => m.isFromConsumer &&
        m.contentType !== 'RichContentEvent' &&
        m.body &&
        !translationCache[translationKey(convId, m.sequence)],
    );
    if (!toTranslate.length) return;
    translating.value = true;
    try {
      const { translations } = await api.translate(toTranslate.map(m => m.body));
      translations.forEach((t, i) => {
        const m = toTranslate[i];
        if (t && t !== m.body) translationCache[translationKey(convId, m.sequence)] = t;
      });
    } catch { /* non-fatal */ } finally {
      translating.value = false;
    }
  }

  watch(translateActive, (on) => {
    if (on) void translateActiveConversation();
  });

  const showParticipants = ref(false);
  const skills = ref<Skill[]>([]);
  const agents = ref<AgentUser[]>([]);
  const agentsLoading = ref(false);
  const transferOpen = ref(false);
  const transferDialog = ref<{ id: string } | null>(null);
  const transferTab = ref<'skill' | 'agent' | 'manager'>('skill');
  const transferSearch = ref('');
  const transferSelected = ref<string | null>(null);
  const transferring = ref(false);

  const filteredSkills = computed(() =>
    skills.value.filter((s) => s.name.toLowerCase().includes(transferSearch.value.toLowerCase())),
  );
  // Show ALL agents (like CCUI); sort online/available first, then by name.
  const matchesSearch = (a: AgentUser) => {
    const q = transferSearch.value.toLowerCase();
    return a.displayName.toLowerCase().includes(q) || a.loginName.toLowerCase().includes(q);
  };
  const statusRank: Record<string, number> = {
    ONLINE: 0,
    OCCUPIED: 1,
    BACK_SOON: 2,
    AWAY: 3,
    UNKNOWN: 4,
    OFFLINE: 5,
  };
  const sortAgents = (list: AgentUser[]) =>
    [...list].sort(
      (a, b) =>
        (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9) ||
        a.displayName.localeCompare(b.displayName),
    );
  const filteredAgents = computed(() =>
    sortAgents(agents.value.filter((a) => a.role === 'Agent' && matchesSearch(a))),
  );
  const filteredManagers = computed(() =>
    sortAgents(agents.value.filter((a) => a.role === 'AgentManager' && matchesSearch(a))),
  );
  const privateModal = ref<{ id: string } | null>(null);
  const privateDraft = ref('');
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;
  const toast = ref<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null);
  const fileInput = ref<HTMLInputElement | null>(null);
  const threadEl = ref<HTMLElement | null>(null);

  // ── Right-hand multi-panel strip ──────────────────────────────────────────
  const panelTab = ref<PanelTab>('sdes');
  const panelTabs: { key: PanelTab; label: string; icon: string }[] = [
    { key: 'sdes', label: 'Customer', icon: 'user' },
    { key: 'notes', label: 'Notes', icon: 'copy' },
    { key: 'pdc', label: 'Canned', icon: 'chat' },
    { key: 'forms', label: 'Forms', icon: 'lock' },
    { key: 'pages', label: 'Pages', icon: 'monitor' },
    { key: 'cobrowse', label: 'Cobrowse', icon: 'monitor' },
  ];
  const panelContainerEl = ref<HTMLElement | null>(null);

  // Notes
  const notes = ref<AgentNote[]>([]);
  const noteDraft = ref('');
  const notesLoading = ref(false);
  const savingNote = ref(false);
  // Customer info
  const customer = ref<CustomerInfo | null>(null);
  const customerLoading = ref(false);
  const sdesRaw = ref<Array<Record<string, unknown>>>([]);
  const sdesLoaded = ref(false);
  // Page nav history
  const pages = ref<PageView[]>([]);
  const pagesLoading = ref(false);
  const timeline = ref<TimelineSegment[]>([]);
  // Predefined content
  const pdcCategories = ref<CannedCategory[]>([]);
  const pdcLoading = ref(false);
  const pdcSearch = ref('');
  const quickMenu = ref<{ prefix: string; items: CannedResponse[] } | null>(null);
  const composerEl = ref<HTMLTextAreaElement | null>(null);

  // ── Secure forms ───────────────────────────────────────────────────────────
  const formPicker = ref(false);
  const forms = ref<SecureFormConfig[]>([]);
  const formsLoading = ref(false);
  const sendingForm = ref(false);
  const formView = ref<{ title: string; result: SecureFormView } | null>(null);

  // ── Cobrowse ───────────────────────────────────────────────────────────────
  const cobrowse = reactive<Record<string, CobrowseState>>({});
  const activeCobrowse = computed(() => (activeId.value ? (cobrowse[activeId.value] ?? null) : null));

  let closeEvents: (() => void) | null = null;

  const active = computed(
    () => conversations.find((c) => c.conversationId === activeId.value) ?? null,
  );
  const activeMessages = computed(() => (activeId.value ? (messages[activeId.value] ?? []) : []));

  function flash(kind: 'ok' | 'err' | 'info', text: string) {
    toast.value = { kind, text };
    setTimeout(() => (toast.value = null), 4500);
  }

  function upsertConversation(c: Conversation) {
    const i = conversations.findIndex((x) => x.conversationId === c.conversationId);
    if (i >= 0) conversations[i] = c;
    else conversations.push(c);
    if (!activeId.value) activeId.value = c.conversationId;
  }

  function onAssigned(c: Conversation) {
    upsertConversation(c);
    void loadTranscript(c.conversationId);
    flash('info', `New conversation assigned: ${c.consumerName}`);
    pingAlert();
  }

  function pingAlert() {
    try {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const tone = (freq: number, start: number, dur: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + dur);
      };
      tone(880, 0, 0.18);
      tone(1320, 0.16, 0.22);
      setTimeout(() => void ctx.close(), 600);
    } catch {
      /* audio unavailable — non-fatal */
    }
  }

  function addMessage(m: ChatMessage & { optimistic?: boolean }) {
    const list = (messages[m.conversationId] ??= []) as Array<ChatMessage & { optimistic?: boolean }>;
    if (!m.optimistic) {
      if (list.some((x) => !x.optimistic && x.sequence === m.sequence)) return;
      const pending = list.findIndex(
        (x) => x.optimistic && !x.isFromConsumer && x.body === m.body,
      );
      if (pending >= 0) {
        list.splice(pending, 1);
      }
    }
    list.push(m);
    list.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    if (m.conversationId === activeId.value) void scrollThread();
  }

  const loadingThread = ref(false);

  async function loadTranscript(id: string): Promise<void> {
    if (messages[id]?.length || transcriptLoading[id]) return;
    transcriptLoading[id] = true;
    try {
      const { messages: history } = await api.getMessages(id);
      const list = (messages[id] ??= []);
      for (const m of history) {
        if (!list.some((x) => x.sequence === m.sequence)) list.push(m);
      }
      list.sort((a, b) => a.sequence - b.sequence);
    } finally {
      transcriptLoading[id] = false;
    }
  }

  async function selectConversation(id: string) {
    activeId.value = id;
    customer.value = null;
    sdesRaw.value = [];
    sdesLoaded.value = false;
    timeline.value = [];
    historyDropdownOpen.value = false;
    historyExpanded.value = new Set();
    void loadNotes();
    void loadPdc();
    void loadCustomer();
    void loadConsumerHistory(id);
    void loadPages();
    void loadFormsTab();
    if (messages[id]?.length) {
      void scrollThread();
      if (translateActive.value) void translateActiveConversation();
      return;
    }
    loadingThread.value = true;
    try {
      await loadTranscript(id);
      void scrollThread();
      if (translateActive.value) void translateActiveConversation();
    } catch (e) {
      flash('err', e instanceof Error ? e.message : String(e));
    } finally {
      loadingThread.value = false;
    }
  }

  async function scrollThread() {
    await nextTick();
    threadEl.value?.scrollTo({ top: threadEl.value.scrollHeight, behavior: 'smooth' });
  }

  onMounted(() => {
    closeEvents = subscribeEvents({
      ready: (d) => {
        connected.value = d.connected;
        d.conversations.forEach(upsertConversation);
        void enrichConversations(d.conversations.map((c) => c.conversationId));
        void api
          .prompts()
          .then(({ prompts }) => {
            const rw = prompts.find(
              (p: LpPrompt) => p.clientType === 'COPILOT_REWRITE' && p.status === 'ACTIVE',
            );
            if (rw) rewritePromptText.value = rw.promptHeader;
          })
          .catch(() => {});
      },
      status: (s) => (connected.value = s.connected),
      conversation: upsertConversation,
      assigned: onAssigned,
      message: addMessage,
      lpError: (e) => flash('err', `LP: ${e.error}`),
    });
    if (activeId.value) void selectConversation(activeId.value);
    clock = setInterval(() => (now.value = Date.now()), 1000);
    void prefetchTranscripts();
    api
      .skills()
      .then((r) => (skills.value = r.skills))
      .catch(() => {});
    window.addEventListener('click', dismissOverlays);
    window.addEventListener('keydown', onKeydown);
  });

  onBeforeUnmount(() => {
    closeEvents?.();
    for (const s of Object.values(cobrowse)) s.close?.();
    if (clock) clearInterval(clock);
    if (hoverTimer) clearTimeout(hoverTimer);
    window.removeEventListener('click', dismissOverlays);
    window.removeEventListener('keydown', onKeydown);
  });

  async function enrichConversations(ids: string[]) {
    for (const id of ids) {
      await api.customerInfo(id).catch(() => {});
    }
  }

  async function prefetchTranscripts() {
    for (const c of conversations) {
      await loadTranscript(c.conversationId).catch(() => {});
    }
  }

  function dismissOverlays() {
    ctxMenu.value = null;
    transferOpen.value = false;
    filterMenuOpen.value = false;
    authMenuOpen.value = false;
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      dismissOverlays();
      if (privateModal.value) privateModal.value = null;
    }
  }

  async function smartRewrite() {
    const text = draft.value.trim();
    if (!text || rewriting.value) return;
    const template = rewritePromptText.value;
    if (!template) {
      flash('err', 'Rewrite prompt not loaded');
      return;
    }
    const prompt = template.replace('{text}', text);
    rewriting.value = true;
    try {
      const { text: rewritten } = await api.llm(prompt);
      if (rewritten.trim()) draft.value = rewritten.trim();
    } catch (e) {
      flash('err', e instanceof Error ? e.message : String(e));
    } finally {
      rewriting.value = false;
    }
  }

  async function send() {
    if (!draft.value.trim() || !activeId.value) return;
    const id = activeId.value;
    let text = draft.value;
    draft.value = '';

    // Outbound translation: agent lang → customer lang when they differ
    if (translateActive.value) {
      const customerLang = customerLangCache[id];
      const agentLang = me.accountLang ?? 'en-US';
      if (customerLang && customerLang.toLowerCase() !== agentLang.toLowerCase()) {
        sendingTranslation.value = true;
        try {
          const { translations } = await api.translate([text], customerLang);
          if (translations[0]?.trim()) text = translations[0].trim();
        } catch { /* send original on failure */ } finally {
          sendingTranslation.value = false;
        }
      }
    }

    try {
      await api.sendMessage(id, text);
      addMessage({
        conversationId: id,
        sequence: Number.MAX_SAFE_INTEGER,
        time: Date.now(),
        body: text,
        contentType: 'text/plain',
        role: 'ASSIGNED_AGENT',
        isFromConsumer: false,
        metadata: null,
        optimistic: true,
      });
    } catch (e) {
      flash('err', e instanceof Error ? e.message : String(e));
      draft.value = text;
    }
  }

  // LP messaging file-sharing supports images (JPEG/PNG/GIF) and PDF only.
  const ALLOWED_FILE_MIME = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'];
  const ALLOWED_FILE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'pdf'];
  const FILE_ACCEPT = '.jpg,.jpeg,.png,.gif,.pdf,image/jpeg,image/png,image/gif,application/pdf';
  const MAX_FILE_BYTES = 25 * 1024 * 1024;

  async function onFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file || !activeId.value) return;
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      const okType = ALLOWED_FILE_MIME.includes(file.type) || ALLOWED_FILE_EXT.includes(ext);
      if (!okType) {
        flash('err', `Unsupported file type. LP allows: ${ALLOWED_FILE_EXT.join(', ')}`);
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        flash('err', `File too large (max ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB)`);
        return;
      }
      await api.sendFile(activeId.value, file);
      flash('ok', `Sent file: ${file.name}`);
    } catch (err) {
      flash('err', err instanceof Error ? err.message : String(err));
    } finally {
      if (fileInput.value) fileInput.value.value = '';
    }
  }

  async function openFormPicker() {
    if (!activeId.value) return;
    formPicker.value = true;
    formsLoading.value = true;
    try {
      const { forms: list } = await api.listSecureForms(activeId.value);
      forms.value = list;
      if (!list.length) flash('info', 'No secure forms configured for this skill.');
    } catch (e) {
      flash('err', e instanceof Error ? e.message : String(e));
    } finally {
      formsLoading.value = false;
    }
  }

  async function sendForm(form: SecureFormConfig) {
    if (!activeId.value || sendingForm.value) return;
    sendingForm.value = true;
    try {
      await api.sendSecureForm(activeId.value, form.id, form.name);
      flash('ok', `Secure form sent: ${form.name}`);
      formPicker.value = false;
    } catch (e) {
      flash('err', e instanceof Error ? e.message : String(e));
    } finally {
      sendingForm.value = false;
    }
  }

  function formIdFromInvitation(invitationId: string): string | undefined {
    const parts = invitationId.split('-');
    return parts.length >= 4 ? parts[parts.length - 3] : undefined;
  }

  async function viewSubmission(m: ChatMessage) {
    if (!activeId.value || !m.secureForm?.submissionId || !m.secureForm.invitationId) return;
    try {
      const result = await api.viewSecureForm(activeId.value, {
        submissionId: m.secureForm.submissionId,
        invitationId: m.secureForm.invitationId,
        formId: m.secureForm.formId ?? formIdFromInvitation(m.secureForm.invitationId),
        sequence: m.sequence,
      });
      formView.value = { title: m.secureForm.title ?? 'Secure form', result };
    } catch (e) {
      flash('err', e instanceof Error ? e.message : String(e));
    }
  }

  function selectTab(tab: PanelTab) {
    panelTab.value = tab;
    void nextTick(() => {
      const container = panelContainerEl.value;
      const idx = panelTabs.findIndex(t => t.key === tab);
      console.log('[selectTab]', tab, idx, container, container?.scrollWidth, container?.clientWidth, container?.offsetWidth);
      if (container && idx >= 0) container.scrollLeft = idx * 400;
      console.log('[selectTab] scrollLeft after:', container?.scrollLeft);
    });
  }

  async function loadNotes() {
    if (!activeId.value) return;
    notesLoading.value = true;
    try {
      const { notes: n } = await api.getNotes(activeId.value);
      notes.value = n;
      const mine = n.find((x) => x.name === me.loginName && !x.isAutoSummary);
      noteDraft.value = mine?.noteContent ?? '';
    } catch (e) {
      flash('err', e instanceof Error ? e.message : String(e));
    } finally {
      notesLoading.value = false;
    }
  }

  async function saveNote() {
    if (!activeId.value || savingNote.value) return;
    savingNote.value = true;
    try {
      const { notes: n } = await api.saveNote(activeId.value, noteDraft.value);
      notes.value = n;
      flash('ok', 'Note saved');
    } catch (e) {
      flash('err', e instanceof Error ? e.message : String(e));
    } finally {
      savingNote.value = false;
    }
  }

  async function loadCustomer() {
    if (!activeId.value) return;
    customerLoading.value = true;
    pagesLoading.value = true;
    const id = activeId.value;
    try {
      const detail = await api.customerInfo(id);
      customer.value = detail.info;
      pages.value = detail.pages ?? [];
      sdesRaw.value = (detail.sdes ?? []) as unknown as Array<Record<string, unknown>>;
      timeline.value = detail.timeline ?? [];
      sdesLoaded.value = true;
      if (detail.info?.language) customerLangCache[id] = detail.info.language;
    } catch (e) {
      flash('err', e instanceof Error ? e.message : String(e));
    } finally {
      customerLoading.value = false;
      pagesLoading.value = false;
    }
  }

  async function loadPages() {
    // Pages now loaded as part of loadCustomer — no separate fetch needed.
  }

  async function loadPdc() {
    pdcLoading.value = true;
    try {
      const skill = active.value?.skillId ?? undefined;
      const { categories } = await api.predefinedContent(skill ?? undefined);
      pdcCategories.value = categories;
    } catch (e) {
      flash('err', e instanceof Error ? e.message : String(e));
    } finally {
      pdcLoading.value = false;
    }
  }

  const hasNotes = computed(() =>
    notes.value.some((n) => !n.isAutoSummary && n.noteContent.trim()),
  );

  const pdcFiltered = computed(() => {
    const q = pdcSearch.value.trim().toLowerCase();
    if (!q) return pdcCategories.value;
    return pdcCategories.value
      .map((cat) => ({
        ...cat,
        items: cat.items.filter(
          (p) => p.title.toLowerCase().includes(q) || (p.text ?? '').toLowerCase().includes(q),
        ),
      }))
      .filter((cat) => cat.items.length);
  });

  function usePdc(item: CannedResponse) {
    const text = item.text ?? item.title;
    draft.value = draft.value ? `${draft.value} ${text}` : text;
    flash('info', item.text ? 'Inserted into composer' : 'Inserted title (no body on this account)');
  }

  const allCanned = computed(() => pdcCategories.value.flatMap((c) => c.items));

  function insertQuick(item: CannedResponse) {
    const el = composerEl.value;
    const text = item.text ?? item.title;
    if (el && quickMenu.value) {
      const cursor = el.selectionStart ?? draft.value.length;
      const before = draft.value.slice(0, cursor);
      const after = draft.value.slice(cursor);
      const stripped = before.slice(0, before.length - quickMenu.value.prefix.length);
      draft.value = stripped + text + after;
    } else {
      draft.value = draft.value ? `${draft.value} ${text}` : text;
    }
    quickMenu.value = null;
    void nextTick(() => composerEl.value?.focus());
  }

  function onComposerKey(e: KeyboardEvent) {
    if (quickMenu.value) {
      if (e.key === 'Escape') {
        e.preventDefault();
        quickMenu.value = null;
        return;
      }
      if (/^[0-9]$/.test(e.key)) {
        const match = quickMenu.value.items.find((it) => it.hotkey?.suffix === e.key);
        if (match) {
          e.preventDefault();
          insertQuick(match);
          return;
        }
      }
      return;
    }
    if (e.key === 'ArrowRight') {
      const el = e.target as HTMLTextAreaElement;
      const cursor = el.selectionStart ?? draft.value.length;
      const before = draft.value.slice(0, cursor);
      let opened = false;
      for (let len = 3; len >= 1 && !opened; len--) {
        const candidate = before.slice(-len);
        if (!candidate) continue;
        const items = allCanned.value.filter((it) => it.hotkey?.prefix === candidate);
        if (items.length) {
          e.preventDefault();
          quickMenu.value = {
            prefix: candidate,
            items: items.sort((a, b) =>
              (a.hotkey?.suffix ?? '').localeCompare(b.hotkey?.suffix ?? ''),
            ),
          };
          opened = true;
        }
      }
    }
  }

  async function loadFormsTab() {
    if (!activeId.value) return;
    formsLoading.value = true;
    try {
      const { forms: list } = await api.listSecureForms(activeId.value);
      forms.value = list;
    } catch (e) {
      flash('err', e instanceof Error ? e.message : String(e));
    } finally {
      formsLoading.value = false;
    }
  }

  function cleanTz(raw: string | null): string | null {
    if (!raw) return null;
    const m = raw.match(/id="([^"]+)"/);
    if (m) return m[1];
    if (raw.length < 60) return raw;
    return null;
  }

  function tryParseJson(s: string): Record<string, any> | null {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }

  function isGroupTail(m: ChatMessage, i: number): boolean {
    if (m.kind) return true;
    const msgs = activeMessages.value;
    const next = msgs[i + 1];
    if (!next || next.kind) return true;
    if (next.isFromConsumer !== m.isFromConsumer) return true;
    if (next.role !== m.role) return true;
    return false;
  }

  const customerSections = computed((): CustomerSection[] => {
    const c = customer.value;
    const conv = active.value;
    const sections: CustomerSection[] = [];
    const r = (
      label: string,
      value: string | null | undefined,
    ): { label: string; value: string } | null => (value ? { label, value } : null);
    const push = (title: string, items: ({ label: string; value: string } | null)[]) => {
      const rows = items.filter((x): x is { label: string; value: string } => x !== null);
      if (rows.length) sections.push({ title, rows });
    };

    push('Consumer Info', [
      r('Consumer name', c?.consumerName),
      r('Consumer ID', c?.consumerId),
      r('Country', c ? [c.city, c.state, c.country].filter(Boolean).join(', ') || null : null),
      r('ISP', c?.isp),
      r('Organization', c?.org !== c?.isp ? c?.org : null),
      r('Referrer', c?.startPageTitle ? `${c.startPageTitle}` : c?.startPage),
      r('IP Address', c?.ipAddress),
    ]);

    push('Conversation Info', [
      r('Skill', conv?.skillName),
      r(
        'Start time',
        c?.startTime ??
          (conv?.startTime
            ? new Date(conv.startTime).toLocaleString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })
            : null),
      ),
      r('Source', c?.source),
      r('Device', c?.device),
      r('Operating System', c?.operatingSystem),
      r('Browser', c?.browser),
      r('Language', c?.language),
      r('Time zone', cleanTz(c?.timeZone ?? null)),
      r(
        'Integration',
        c?.integration
          ? `${c.integration}${c.integrationVersion ? ` ${c.integrationVersion}` : ''}`
          : null,
      ),
      r('Conversation ID', conv?.conversationId),
      r('MCS', c?.mcs != null ? String(c.mcs) : null),
    ]);

    push('Campaign Info', [
      r('Goal', c?.goalName),
      r('Campaign', c?.campaignName),
      r('Engagement Name', c?.engagementName),
      r('Engagement skill', conv?.skillName),
      r('Line of business', c?.lobName),
      r('Target Audience', c?.visitorProfileName),
      r('Behavior', c?.visitorBehaviorName),
      r(
        'Source',
        c?.engagementSource
          ?.replace(/_/g, ' ')
          .toLowerCase()
          .replace(/\b\w/g, (l) => l.toUpperCase()) ?? null,
      ),
      r('Entry point', c?.locationName),
    ]);

    return sections;
  });

  const participantList = computed(() => {
    if (!active.value || !activeMessages.value.length) return [];
    const seen = new Map<string, { role: string; name: string }>();
    seen.set('consumer', { role: 'Visitor', name: active.value.consumerName });
    for (const m of activeMessages.value) {
      if (m.isFromConsumer) continue;
      const role = (m.role ?? '')
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, (l) => l.toUpperCase());
      if (role && !seen.has(m.role)) {
        seen.set(m.role, { role, name: role });
      }
    }
    if (active.value.assignedAgentId) {
      seen.set('agent', { role: 'Agent', name: me.loginName });
    }
    return [...seen.values()];
  });

  const sdeSections = computed((): CustomerSection[] => {
    const raw = sdesRaw.value;
    if (!raw.length) return [];
    const sections: CustomerSection[] = [];
    const s = (v: unknown): string | null => (v != null && v !== '' ? String(v) : null);
    const fmt$ = (v: unknown): string | null => {
      const n = Number(v);
      return !isNaN(n) && v !== '' && v != null
        ? `$${n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : null;
    };

    const byType: Record<string, Record<string, unknown>[]> = {};
    for (const item of raw) {
      const obj = item as Record<string, unknown>;
      // MI sdes: { type: 'personal', data: {...} }
      // SDK sdes: { personal: {...} }
      if (obj.type && obj.data) {
        const t = obj.type as string;
        if (!byType[t]) byType[t] = [];
        byType[t].push(obj.data as Record<string, unknown>);
      } else {
        for (const key of Object.keys(obj)) {
          if (!byType[key]) byType[key] = [];
          byType[key].push(obj[key] as Record<string, unknown>);
        }
      }
    }

    const personals = byType['personal'] ?? [];
    for (const p of personals) {
      const rows: { label: string; value: string }[] = [];
      // MI uses name/surname; SDK uses firstname/lastname
      const name = [s(p.name ?? p.firstname), s(p.surname ?? p.lastname)].filter(Boolean).join(' ');
      if (name) rows.push({ label: 'Name', value: name });
      // MI: contacts[].personalContact.email/phone
      const contacts = Array.isArray(p.contacts) ? p.contacts as Array<Record<string, unknown>> : [];
      for (const c of contacts) {
        const pc = (c.personalContact ?? c) as Record<string, unknown>;
        if (s(pc.email)) rows.push({ label: 'Email', value: s(pc.email)! });
        if (s(pc.phone)) rows.push({ label: 'Phone', value: s(pc.phone)! });
      }
      // SDK flat fields
      if (!contacts.length) {
        if (s(p.email)) rows.push({ label: 'Email', value: s(p.email)! });
        if (s(p.phone)) rows.push({ label: 'Phone', value: s(p.phone)! });
      }
      if (s(p.age)) rows.push({ label: 'Age', value: s(p.age)! });
      if (s(p.gender)) rows.push({ label: 'Gender', value: s(p.gender)! });
      if (s(p.language)) rows.push({ label: 'Language', value: s(p.language)! });
      const company = p.company as Record<string, unknown> | undefined;
      if (company) {
        if (s(company.name)) rows.push({ label: 'Company', value: s(company.name)! });
        if (s(company.size)) rows.push({ label: 'Company size', value: s(company.size)! });
      }
      if (rows.length) sections.push({ title: 'Personal', rows });
    }

    const ctmrinfos = byType['ctmrinfo'] ?? [];
    for (const c of ctmrinfos) {
      const rows: { label: string; value: string }[] = [];
      if (s(c.ctype)) rows.push({ label: 'Customer type', value: s(c.ctype)! });
      // MI uses customerId; SDK uses cid
      if (s(c.customerId ?? c.cid)) rows.push({ label: 'Customer ID', value: s(c.customerId ?? c.cid)! });
      if (s(c.companyBranch)) rows.push({ label: 'Branch', value: s(c.companyBranch)! });
      if (s(c.accountName)) rows.push({ label: 'Account', value: s(c.accountName)! });
      if (s(c.socialId)) rows.push({ label: 'Social ID', value: s(c.socialId)! });
      if (s(c.imei)) rows.push({ label: 'IMEI', value: s(c.imei)! });
      if (s(c.userName)) rows.push({ label: 'Username', value: s(c.userName)! });
      if (s(c.role)) rows.push({ label: 'Role', value: s(c.role)! });
      const bal = fmt$(c.balance);
      if (bal) rows.push({ label: 'Balance', value: bal });
      if (s(c.currency)) rows.push({ label: 'Currency', value: s(c.currency)! });
      if (s(c.registrationDate)) rows.push({ label: 'Registered', value: s(c.registrationDate)! });
      if (s(c.lastPaymentDate)) rows.push({ label: 'Last payment', value: s(c.lastPaymentDate)! });
      if (rows.length) sections.push({ title: 'Customer Info', rows });
    }

    const carts = byType['cart'] ?? [];
    for (const cart of carts) {
      const rows: { label: string; value: string }[] = [];
      const total = fmt$(cart.total);
      if (total) rows.push({ label: 'Cart total', value: total });
      if (s(cart.currency)) rows.push({ label: 'Currency', value: s(cart.currency)! });
      const prods = Array.isArray(cart.products) ? (cart.products as Record<string, unknown>[]) : [];
      for (const prod of prods.slice(0, 5)) {
        const pname = s(prod.name) ?? s((prod.product as Record<string, unknown>)?.name);
        const qty = s(prod.quantity);
        const price = fmt$(prod.price ?? (prod.product as Record<string, unknown>)?.price);
        if (pname)
          rows.push({
            label: 'Item',
            value: [pname, qty ? `×${qty}` : null, price].filter(Boolean).join(' '),
          });
      }
      if (rows.length) sections.push({ title: 'Cart', rows });
    }

    const purchases = byType['purchase'] ?? [];
    for (const pur of purchases) {
      const rows: { label: string; value: string }[] = [];
      const total = fmt$(pur.total);
      if (total) rows.push({ label: 'Order total', value: total });
      if (s(pur.orderId)) rows.push({ label: 'Order ID', value: s(pur.orderId)! });
      if (s(pur.currency)) rows.push({ label: 'Currency', value: s(pur.currency)! });
      const purCart = pur.cart as Record<string, unknown> | undefined;
      const prods = Array.isArray(purCart?.products)
        ? (purCart!.products as Record<string, unknown>[])
        : [];
      for (const prod of prods.slice(0, 5)) {
        const pname = s(prod.name) ?? s((prod.product as Record<string, unknown>)?.name);
        const price = fmt$(prod.price ?? (prod.product as Record<string, unknown>)?.price);
        if (pname)
          rows.push({ label: 'Item', value: [pname, price].filter(Boolean).join(' ') });
      }
      if (rows.length) sections.push({ title: 'Purchase', rows });
    }

    const services = byType['service'] ?? [];
    for (const svc of services) {
      const rows: { label: string; value: string }[] = [];
      if (s(svc.topic)) rows.push({ label: 'Topic', value: s(svc.topic)! });
      if (s(svc.status)) rows.push({ label: 'Status', value: s(svc.status)! });
      if (s(svc.category)) rows.push({ label: 'Category', value: s(svc.category)! });
      if (s(svc.serviceId)) rows.push({ label: 'Service ID', value: s(svc.serviceId)! });
      if (rows.length) sections.push({ title: 'Service Activity', rows });
    }

    const leads = byType['lead'] ?? [];
    for (const lead of leads) {
      const rows: { label: string; value: string }[] = [];
      if (s(lead.topic)) rows.push({ label: 'Topic', value: s(lead.topic)! });
      if (s(lead.leadId)) rows.push({ label: 'Lead ID', value: s(lead.leadId)! });
      const val = fmt$(lead.value);
      if (val) rows.push({ label: 'Value', value: val });
      if (rows.length) sections.push({ title: 'Lead', rows });
    }

    const marketings = byType['marketingCampaignInfo'] ?? byType['marketing'] ?? [];
    for (const mkt of marketings) {
      const rows: { label: string; value: string }[] = [];
      if (s(mkt.affiliate)) rows.push({ label: 'Affiliate', value: s(mkt.affiliate)! });
      if (s(mkt.campaignId)) rows.push({ label: 'Campaign ID', value: s(mkt.campaignId)! });
      if (s(mkt.keyword)) rows.push({ label: 'Keyword', value: s(mkt.keyword)! });
      if (s(mkt.channel)) rows.push({ label: 'Channel', value: s(mkt.channel)! });
      if (rows.length) sections.push({ title: 'Marketing', rows });
    }

    const viewed = byType['viewedProduct'] ?? [];
    if (viewed.length) {
      const rows: { label: string; value: string }[] = [];
      for (const vp of viewed.slice(0, 6)) {
        const prod = (vp.products ?? vp.product ?? vp) as Record<string, unknown>;
        const name = s(prod.name);
        const price = fmt$(prod.price);
        if (name) rows.push({ label: 'Product', value: [name, price].filter(Boolean).join(' — ') });
      }
      if (rows.length) sections.push({ title: 'Viewed Products', rows });
    }

    const logins = byType['login'] ?? [];
    for (const lg of logins) {
      if (s(lg.status))
        sections.push({ title: 'Login', rows: [{ label: 'Status', value: s(lg.status)! }] });
    }

    return sections;
  });

  function pageTime(ts: number | null): string {
    return ts
      ? new Date(ts).toLocaleString([], {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '';
  }
  function hostOf(url: string): string {
    try {
      return new URL(url).hostname + new URL(url).pathname;
    } catch {
      return url;
    }
  }

  async function startCobrowse(mode: CobrowseMode = 'cobrowse') {
    const id = activeId.value;
    if (!id) return;
    if (cobrowse[id] && !['ended', 'error'].includes(cobrowse[id].phase)) return;

    const state: CobrowseState = reactive({
      sessionKey: '',
      phase: 'connecting',
      mode,
      roomUrl: null,
      callLink: null,
      error: null,
      log: [],
      close: null,
    });
    cobrowse[id] = state;
    selectTab('cobrowse');

    const logLine = (s: string) => state.log.push(`${new Date().toLocaleTimeString()} · ${s}`);

    try {
      const { sessionKey } = await api.startCobrowse(id, { mode });
      state.sessionKey = sessionKey;
      logLine('session starting…');

      state.close = subscribeCobrowse(sessionKey, (ev) => {
        const e = ev as {
          type: string;
          signedUrl?: string;
          callLink?: string;
          error?: string;
          step?: string;
        };
        if (!['debug', 'handshake'].includes(e.type)) logLine(e.type);

        switch (e.type) {
          case 'connected':
            if (state.phase === 'connecting') state.phase = 'inviting';
            break;
          case 'inviteSent':
            state.callLink = e.callLink ?? null;
            state.phase = 'awaiting-accept';
            break;
          case 'consumerJoining':
            break;
          case 'canStartCall':
            if (e.signedUrl) {
              state.roomUrl = e.signedUrl;
              state.phase = 'active';
              flash('ok', 'Customer joined — cobrowse active');
            }
            break;
          case 'inviteFailed':
          case 'error':
            state.phase = 'error';
            state.error = e.error ?? 'cobrowse error';
            flash('err', `Cobrowse: ${state.error}`);
            break;
          case 'disconnected':
            if (state.phase !== 'active') state.phase = 'ended';
            break;
        }
      });
    } catch (e) {
      state.phase = 'error';
      state.error = e instanceof Error ? e.message : String(e);
      flash('err', state.error);
    }
  }

  async function stopCobrowse(id: string) {
    const state = cobrowse[id];
    if (!state) return;
    state.close?.();
    if (state.sessionKey) await api.stopCobrowse(state.sessionKey).catch(() => {});
    delete cobrowse[id];
  }

  function cobrowsePhaseLabel(p: CobrowsePhase): string {
    return {
      connecting: 'Connecting…',
      inviting: 'Sending invite to customer…',
      'awaiting-accept': 'Waiting for customer to accept…',
      active: 'Active',
      ended: 'Session ended',
      error: 'Error',
    }[p];
  }

  function cobrowseModeLabel(m: CobrowseMode): string {
    return { cobrowse: 'Cobrowse', 'video-call': 'Video call', 'voice-call': 'Voice call' }[m];
  }

  function shortId(id: string) {
    return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
  }

  function secondsLeft(c: Conversation): number | null {
    if (c.ttrDeadline != null) return Math.round((c.ttrDeadline - now.value) / 1000);
    return c.ttrSecondsLeft;
  }

  function liveStatus(c: Conversation): ConvStatus {
    if (c.status === 'queued' || c.status === 'idle') return c.status;
    const left = secondsLeft(c);
    if (left != null && left < 0) return 'overdue';
    if (c.ttrType === 'URGENT' || c.ttrType === 'PRIORITIZED') return 'urgent';
    if (left != null && left <= 30) return 'urgent';
    return 'active';
  }

  function transcriptMatches(id: string, q: string): boolean {
    const list = messages[id];
    if (!list) return false;
    return list.some((m) => (m.body ?? '').toLowerCase().includes(q));
  }

  /**
   * CCUI ordering: the conversation that needs a reply SOONEST sits at the top, so
   * the agent always works the longest-waiting customer next. Once the agent replies,
   * the TTR clears (ttrDeadline → null) and the conversation drops below all the ones
   * still awaiting a reply.
   *
   *   1. Conversations with an active reply deadline (customer is waiting), ordered by
   *      EARLIEST deadline first — `effectiveTTR` = customerMessageTime + SLA, so the
   *      earliest deadline is the longest-waiting customer. Overdue (deadline already
   *      passed) naturally sorts to the very top.
   *   2. Then everything with no deadline (idle = awaiting the customer, or queued),
   *      by most-recent activity.
   */
  function sortKey(c: Conversation): { waiting: boolean; deadline: number; updated: number } {
    const left = secondsLeft(c); // recomputed against the live clock
    const waiting = c.ttrDeadline != null || (left != null && left < 0);
    return {
      waiting,
      deadline: c.ttrDeadline ?? Number.POSITIVE_INFINITY,
      updated: c.updateTime ?? 0,
    };
  }

  const visibleConversations = computed(() => {
    const q = search.value.trim().toLowerCase();
    // Touch `now` so the order re-evaluates as deadlines pass.
    void now.value;
    return conversations
      .filter((c) => filter.value === 'all' || liveStatus(c) === filter.value)
      .filter(
        (c) =>
          !q ||
          c.consumerName.toLowerCase().includes(q) ||
          (c.lastMessage ?? '').toLowerCase().includes(q) ||
          (c.skillName ?? '').toLowerCase().includes(q) ||
          transcriptMatches(c.conversationId, q),
      )
      .sort((a, b) => {
        const ka = sortKey(a);
        const kb = sortKey(b);
        // Awaiting-reply conversations always rank above idle ones.
        if (ka.waiting !== kb.waiting) return ka.waiting ? -1 : 1;
        // Both awaiting: earliest reply deadline first (= longest-waiting customer).
        if (ka.waiting && ka.deadline !== kb.deadline) return ka.deadline - kb.deadline;
        // Neither awaiting (or same deadline): most recent activity first.
        return kb.updated - ka.updated;
      });
  });

  const counts = computed(() => {
    const out: Record<Filter, number> = {
      all: conversations.length,
      queued: 0,
      overdue: 0,
      urgent: 0,
      active: 0,
      idle: 0,
    };
    for (const c of conversations) out[liveStatus(c)]++;
    return out;
  });

  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'overdue', label: 'Past SLA' },
    { key: 'urgent', label: 'Urgent' },
    { key: 'active', label: 'Active' },
    { key: 'queued', label: 'Queued' },
    { key: 'idle', label: 'Idle' },
  ];

  const statusBarOrder: ConvStatus[] = ['overdue', 'urgent', 'active', 'queued', 'idle'];

  function toggleFilter(f: Filter) {
    filter.value = filter.value === f ? 'all' : f;
    filterMenuOpen.value = false;
  }

  function onRowEnter(id: string) {
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      hoverId.value = id;
      void loadTranscript(id);
    }, 350);
  }
  function onRowLeave() {
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverId.value = null;
  }

  function tooltipLines(id: string): { who: string; body: string }[] {
    const list = messages[id] ?? [];
    return list
      .filter((m) => typeof m.body === 'string' && m.body.trim())
      .slice(-6)
      .map((m) => ({ who: m.isFromConsumer ? 'Customer' : 'Agent', body: m.body }));
  }

  function openCtxMenu(e: MouseEvent, id: string) {
    e.preventDefault();
    transferOpen.value = false;
    const x = Math.min(e.clientX, window.innerWidth - 210);
    const y = Math.min(e.clientY, window.innerHeight - 220);
    ctxMenu.value = { id, x, y };
  }

  async function endConversation(id: string) {
    ctxMenu.value = null;
    try {
      await api.closeConversation(id);
      flash('ok', 'Conversation ended');
    } catch (e) {
      flash('err', e instanceof Error ? e.message : String(e));
    }
  }

  async function backToQueue(id: string) {
    ctxMenu.value = null;
    try {
      await api.backToQueue(id);
      flash('ok', 'Returned to queue');
    } catch (e) {
      flash('err', e instanceof Error ? e.message : String(e));
    }
  }

  function openTransferDialog(id: string) {
    ctxMenu.value = null;
    transferSearch.value = '';
    transferSelected.value = null;
    transferTab.value = 'skill';
    transferDialog.value = { id };
    if (!agents.value.length && !agentsLoading.value) {
      agentsLoading.value = true;
      api
        .agents()
        .then((r) => {
          agents.value = r.agents;
        })
        .catch(() => {})
        .finally(() => {
          agentsLoading.value = false;
        });
    }
  }

  async function doTransfer() {
    if (!transferDialog.value || !transferSelected.value) return;
    const toAgent = transferTab.value === 'agent' || transferTab.value === 'manager';

    // Warn before transferring to an agent who is AWAY / BACK_SOON (logged in but
    // not actively available).
    if (toAgent) {
      const a = agents.value.find((x) => x.id === transferSelected.value);
      if (a && (a.status === 'AWAY' || a.status === 'BACK_SOON')) {
        const label = a.status === 'AWAY' ? 'away' : 'set to back soon';
        const ok = window.confirm(
          `${a.displayName || a.loginName} is ${label}. They may not pick up promptly. Transfer anyway?`,
        );
        if (!ok) return;
      }
    }

    transferring.value = true;
    try {
      const target = toAgent
        ? { agentId: transferSelected.value }
        : { skillId: transferSelected.value };
      await api.transfer(transferDialog.value.id, target);
      flash('ok', 'Transferred');
      transferDialog.value = null;
    } catch (e) {
      flash('err', e instanceof Error ? e.message : String(e));
    } finally {
      transferring.value = false;
    }
  }

  async function transferTo(id: string, skillId: string) {
    ctxMenu.value = null;
    transferOpen.value = false;
    try {
      await api.transfer(id, { skillId });
      flash('ok', 'Transferred');
    } catch (e) {
      flash('err', e instanceof Error ? e.message : String(e));
    }
  }

  function openPrivateModal(id: string) {
    ctxMenu.value = null;
    privateDraft.value = '';
    privateModal.value = { id };
  }

  async function sendPrivate() {
    if (!privateModal.value || !privateDraft.value.trim()) return;
    const { id } = privateModal.value;
    const text = privateDraft.value;
    privateModal.value = null;
    try {
      await api.sendPrivate(id, text);
      // Optimistically render as a private (agents-only) bubble; the SSE echo (which
      // also carries audience) reconciles it by body+sender.
      addMessage({
        conversationId: id,
        sequence: Number.MAX_SAFE_INTEGER,
        time: Date.now(),
        body: text,
        contentType: 'text/plain',
        role: 'ASSIGNED_AGENT',
        isFromConsumer: false,
        metadata: null,
        audience: 'AGENTS_AND_MANAGERS',
        optimistic: true,
      });
      flash('ok', 'Private message sent');
    } catch (e) {
      flash('err', e instanceof Error ? e.message : String(e));
    }
  }

  function initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
  }

  function avatarStyle(seed: string): string {
    const PALETTES = [
      { bg: '#e03c3c', text: '#fff' },
      { bg: '#e0713c', text: '#fff' },
      { bg: '#d4a017', text: '#fff' },
      { bg: '#3db55e', text: '#fff' },
      { bg: '#1da9a0', text: '#fff' },
      { bg: '#2878d4', text: '#fff' },
      { bg: '#6c47d4', text: '#fff' },
      { bg: '#b83cb8', text: '#fff' },
      { bg: '#c4386a', text: '#fff' },
      { bg: '#3c8fb8', text: '#fff' },
    ];
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    const { bg, text } = PALETTES[hash % PALETTES.length];
    return `background:${bg};color:${text};border:none;`;
  }

  type StatusMeta = {
    icon: string;
    color: string;
    dot: string;
    badge: string;
    tone: string;
    ring: string;
  };
  function statusMeta(s: ConvStatus): StatusMeta {
    return {
      overdue: {
        icon: 'bell',
        color: 'text-rose-400',
        dot: 'bg-rose-500',
        badge: 'badge--overdue',
        tone: 'bg-rose-500/20 text-rose-200',
        ring: 'ring-rose-500/40',
      },
      urgent: {
        icon: 'alarm',
        color: 'text-amber-400',
        dot: 'bg-amber-400',
        badge: 'badge--urgent',
        tone: 'bg-amber-500/20 text-amber-100',
        ring: 'ring-amber-400/40',
      },
      active: {
        icon: 'chat',
        color: 'text-emerald-400',
        dot: 'bg-emerald-400',
        badge: 'badge--active',
        tone: 'bg-emerald-500/20 text-emerald-100',
        ring: 'ring-emerald-400/40',
      },
      queued: {
        icon: 'users',
        color: 'text-orange-400',
        dot: 'bg-orange-400',
        badge: 'badge--queued',
        tone: 'bg-orange-500/20 text-orange-100',
        ring: 'ring-orange-400/40',
      },
      idle: {
        icon: 'moon',
        color: 'text-sky-400',
        dot: 'bg-slate-500',
        badge: 'badge--idle',
        tone: 'bg-white/10 text-slate-200',
        ring: 'ring-white/20',
      },
    }[s];
  }

  function statusLabel(c: Conversation): string {
    const s = liveStatus(c);
    const left = secondsLeft(c);
    if (s === 'queued') return 'in queue';
    if (s === 'overdue') return `past SLA${left != null ? ` ${fmtDur(-left)}` : ''}`;
    if (s === 'urgent') return left != null && left >= 0 ? `reply in ${fmtDur(left)}` : 'urgent';
    if (s === 'active') return left != null ? `reply in ${fmtDur(left)}` : 'needs reply';
    return 'waiting';
  }

  function fmtDur(sec: number): string {
    const s = Math.max(0, Math.round(sec));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
    const h = Math.floor(m / 60);
    return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
  }

  function relTime(ts: number | null): string {
    if (!ts) return '';
    const diff = (now.value - ts) / 1000;
    if (diff < 60) return 'now';
    return fmtDur(diff) + ' ago';
  }

  function channelIcon(channel: string | null): string | null {
    if (!channel) return null;
    const map: Record<string, string> = {
      FACEBOOK: 'facebook.png',
      FACEBOOK_MESSENGER: 'facebook.png',
      FB: 'facebook.png',
      SHARK: 'cog.png',
      WEB: 'cog.png',
      WEB_MESSAGING: 'web.png',
      WHATSAPP: 'WhatsApp.svg.png',
      LINE: 'line.png',
      APPLE_BUSINESS_CHAT: 'IMessage_logo.svg',
      IMESSAGE: 'IMessage_logo.svg',
      GOOGLE_RCS: 'google_messages.png',
      GOOGLE_BUSINESS_MESSAGES: 'google.webp',
      VIBER: 'viber.jpg',
      EXTEND: 'extend-transbg.png',
    };
    const file = map[channel.toUpperCase()];
    return file ? `/channels/${file}` : null;
  }

  function msgTime(ts: number): string {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function dayLabel(ts: number): string {
    const d = new Date(ts);
    const today = new Date(now.value);
    const isSameDay = d.toDateString() === today.toDateString();
    if (isSameDay) return 'Today';
    const yest = new Date(today);
    yest.setDate(today.getDate() - 1);
    if (d.toDateString() === yest.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function startsNewDay(m: ChatMessage, i: number): boolean {
    if (i === 0) return true;
    const prev = activeMessages.value[i - 1];
    return new Date(m.time).toDateString() !== new Date(prev.time).toDateString();
  }

  function isImageFile(ft: string | null): boolean {
    return ['PNG', 'JPG', 'JPEG', 'GIF'].includes((ft ?? '').toUpperCase());
  }

  function imageSrc(f: NonNullable<ChatMessage['file']>): string {
    const p = f.preview;
    if (p) {
      if (p.startsWith('data:')) return p;
      return `data:image/${(f.fileType ?? 'jpeg').toLowerCase()};base64,${p}`;
    }
    return fileUrl(f);
  }

  function parseSummary(body: string): {
    synopsis: string;
    rows: { label: string; value: string }[];
  } {
    const lines = body
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const rows: { label: string; value: string }[] = [];
    const synopsisParts: string[] = [];
    for (const line of lines) {
      const m = line.match(/^([A-Za-z][\w /]{1,30}?):\s*(.*)$/);
      if (m) rows.push({ label: m[1].trim(), value: m[2].trim() || '—' });
      else synopsisParts.push(line);
    }
    const synIdx = rows.findIndex((r) => /^synopsis$/i.test(r.label));
    if (synIdx >= 0) {
      synopsisParts.unshift(rows[synIdx].value);
      rows.splice(synIdx, 1);
    }
    return { synopsis: synopsisParts.join(' '), rows };
  }

  const copiedId = ref<number | null>(null);
  async function copySummary(m: ChatMessage) {
    try {
      await navigator.clipboard.writeText(m.body);
      copiedId.value = m.sequence;
      setTimeout(
        () => (copiedId.value = copiedId.value === m.sequence ? null : copiedId.value),
        1500,
      );
    } catch {
      flash('err', 'Copy failed');
    }
  }

  // ── Agent availability state (ONLINE / AWAY / BACK_SOON / OFFLINE) ──────────
  const agentState = ref<AgentAvailState>((me.agentState as AgentAvailState) ?? 'ONLINE');
  const stateChanging = ref(false);
  const statusReasons = ref<StatusReason[]>([]);
  const reasonSearch = ref('');
  const pendingState = ref<'AWAY' | 'BACK_SOON' | null>(null);

  const AVAIL_STATES: { key: AgentAvailState; label: string; color: string }[] = [
    { key: 'ONLINE', label: 'Online', color: '#22c55e' },
    { key: 'AWAY', label: 'Away', color: '#f59e0b' },
    { key: 'BACK_SOON', label: 'Back soon', color: '#3b82f6' },
  ];

  const currentStateColor = computed(
    () => AVAIL_STATES.find((s) => s.key === agentState.value)?.color ?? '#22c55e',
  );

  const filteredReasons = computed(() => {
    const q = reasonSearch.value.trim().toLowerCase();
    const list = statusReasons.value.filter((r) => r.type === pendingState.value);
    if (!q) return list;
    return list.filter((r) => r.text.toLowerCase().includes(q));
  });

  async function loadStatusReasons() {
    if (statusReasons.value.length) return;
    try {
      statusReasons.value = await api.getStatusReasons();
    } catch {
      /* non-fatal */
    }
  }

  async function changeState(state: AgentAvailState) {
    if (stateChanging.value) return;
    if ((state === 'AWAY' || state === 'BACK_SOON') && statusReasons.value.some((r) => r.type === state)) {
      pendingState.value = state;
      reasonSearch.value = '';
      return;
    }
    await applyState(state);
  }

  async function applyState(state: AgentAvailState) {
    stateChanging.value = true;
    try {
      await api.setAgentState(state);
      agentState.value = state;
      pendingState.value = null;
      reasonSearch.value = '';
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
      agentState.value = 'OFFLINE';
    } catch {
      /* ignore */
    } finally {
      stateChanging.value = false;
    }
  }

  const agentSkillIds = computed(() => me.skillIds ?? []);
  // Resolve the agent's skill ids to names via the account skills list (loaded for
  // transfer). Falls back to the id string until the list arrives / if not found.
  const agentSkills = computed(() => {
    const byId = new Map(skills.value.map((s) => [String(s.id), s.name]));
    return (me.skillIds ?? []).map((id) => ({ id: String(id), name: byId.get(String(id)) ?? String(id) }));
  });

  function signOut() {
    emit('sign-out');
  }
  function toggleTheme() {
    emit('toggle-theme');
  }

  return {
    // agent availability
    agentState,
    stateChanging,
    statusReasons,
    reasonSearch,
    pendingState,
    AVAIL_STATES,
    currentStateColor,
    filteredReasons,
    loadStatusReasons,
    changeState,
    applyState,
    doReturnToQueue,
    agentSkillIds,
    agentSkills,
    // identity
    me,
    // core state
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
    historyList,
    historyLoading,
    historyDropdownOpen,
    historyExpanded,
    historyMessages,
    historyMessagesLoading,
    toggleHistoryConv,
    closeHistoryDropdown,
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
    sdesLoaded,
    pages,
    pagesLoading,
    timeline,
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
    // computed
    active,
    activeMessages,
    hasNotes,
    pdcFiltered,
    allCanned,
    customerSections,
    participantList,
    sdeSections,
    visibleConversations,
    counts,
    filters,
    statusBarOrder,
    // methods
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
    // file constants
    FILE_ACCEPT,
    MAX_FILE_BYTES,
    // passthrough utils used by templates
    fileUrl,
    // emits
    signOut,
    toggleTheme,
  };
}
