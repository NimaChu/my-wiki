import { lazy, Suspense, type CSSProperties, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bot, BookOpen, Check, ChevronDown, CirclePause, Copy, Download, Globe2, HardDriveDownload, History, Layers3, Maximize2, MessageSquarePlus, Minimize2, MoveDiagonal2, NotebookPen, PawPrint, SendHorizontal, Trash2, X } from "lucide-react";
import { AgentAnswer, AgentInfo, AgentPreferences, AnswerStream, Job, localApi, PetAppearance, UniverseSummary, waitForAnswer, waitForJob } from "./api";
import { shouldSubmitVikiComposer } from "./viki-composer.js";
import { vikiModelSelection } from "./viki-models.js";
import { stripDanglingSourceFootnotes } from "./answer-markdown.js";
import { promoteVaultMarkdownImages } from "./viki-markdown.js";
import { conversationExportBundle, conversationFilename, conversationNoteBundle, conversationToMarkdown } from "./viki-conversation.js";

const VikiMarkdown = lazy(() => import("./VikiMarkdown"));

type Language = "en" | "zh";
type VikiEdge = "top" | "right" | "bottom" | "left";
type VikiPosition = { x: number; y: number; edge: VikiEdge };
type VikiPanelSize = { width: number; height: number };
type PetAnimationState = "idle" | "running-right" | "running-left" | "waving" | "failed" | "waiting" | "working";
type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: AgentAnswer["sources"];
  images?: AgentAnswer["images"];
  contextExcluded?: boolean;
  contextReceipt?: AgentAnswer["contextReceipt"];
};
type VikiConversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  pendingJobId?: string;
  messages: ChatMessage[];
};
type VikiChatState = { activeId: string; conversations: VikiConversation[] };
type ActiveRequest = { jobId: string; conversationId: string; provider: string; model: string; webSearch: boolean; galaxies: string[] };
type OpenedImage = { path: string; caption: string; url: string };

const LAUNCHER_SIZE = 80;
const EDGE_GAP = 16;
const PANEL_GAP = 10;
const DEFAULT_PANEL_SIZE = { width: 640, height: 480 };
const MIN_PANEL_SIZE = { width: 480, height: 360 };
const POSITION_KEY = "my-wiki-viki-position";
const PROVIDER_KEY = "my-wiki-viki-provider";
const MODEL_KEY = "my-wiki-viki-models-v1";
const PET_KEY = "my-wiki-viki-pet";
const PANEL_SIZE_KEY = "my-wiki-viki-panel-size";
const CHAT_STATE_KEY = "my-wiki-viki-chat-state-v1";
const WEB_SEARCH_KEY = "my-wiki-viki-web-search";
const MAX_CONVERSATIONS = 30;
const MAX_MESSAGES_PER_CONVERSATION = 120;
const MAX_STORED_MESSAGE_CHARS = 512 * 1024;
const CHAT_STORAGE_CHAR_LIMIT = 2 * 1024 * 1024;
const CONTEXT_MESSAGE_CHARS = 4000;

const copy = {
  en: {
    companion: "Knowledge companion",
    open: "Ask Viki",
    close: "Close Viki",
    welcome: "Ask me anything in your knowledge vault. I will start with Concepts and verify important details against References.",
    placeholder: "Ask your knowledge vault...",
    send: "Send",
    thinking: [
      "Opening the most relevant Concepts",
      "Tracing links across the knowledge graph",
      "Checking claims against References",
      "Organizing evidence into a clear answer",
      "Still working carefully on the details"
    ],
    unavailable: "No available Viki execution provider.",
    sources: "Evidence",
    ready: "Ready",
    busy: "Working",
    backgroundBusy: "Another conversation is answering. Wait for it to finish.",
    pause: "Pause current answer",
    paused: "Answer paused. You can continue with another question.",
    incomplete: "Incomplete answer.",
    failureReason: "Failure reason",
    phases: { starting: "Starting agent", thinking: "Thinking", reading: "Reading evidence", searching: "Searching", generating: "Writing the answer", retrying: "Trying the fallback model" } as Record<string, string>,
    resize: "Resize Viki",
    enterFullscreen: "Open full screen",
    exitFullscreen: "Exit full screen",
    agentCli: "Execution",
    model: "Model",
    savedModel: "Saved model",
    chooseModel: "Select a model",
    noModels: "No available models",
    agentSettings: "Agent and model",
    cliDefault: "CLI default",
    currentCli: "Current answer",
    nextCli: "Next answer",
    imageDetail: "Open image detail",
    closeImage: "Close image detail",
    pet: "Viki pet",
    history: "Conversation history",
    newConversation: "New conversation",
    deleteConversation: "Delete conversation",
    conversations: "Conversations",
    copyAnswer: "Copy answer",
    copied: "Copied",
    exportConversation: "Export conversation",
    exportLocal: "Download locally",
    exportNote: "Export to quick notes",
    webSearch: "Search the web",
    webSearchOn: "Web search on",
    webSearchOff: "Web search off",
    galaxyScope: "Knowledge galaxies",
    allGalaxies: "All galaxies",
    selectedGalaxies: "Selected galaxies",
    galaxyCount: "galaxies",
    user: "User",
    assistant: "Viki",
    retry: "Please try again."
  },
  zh: {
    companion: "知识伙伴",
    open: "问 Viki",
    close: "关闭 Viki",
    welcome: "可以直接问我知识库里的任何问题。我会优先查阅概念，并用参考资料核实重要信息。",
    placeholder: "向你的知识库提问...",
    send: "发送",
    thinking: [
      "正在定位最相关的概念",
      "正在沿知识关系查找线索",
      "正在对照参考资料核实依据",
      "正在组织证据与回答结构",
      "仍在认真处理其中的细节"
    ],
    unavailable: "暂无可用的 Viki 执行方式。",
    sources: "参考证据",
    ready: "已就绪",
    busy: "工作中",
    backgroundBusy: "另一会话正在回答，请等待完成。",
    pause: "暂停当前回答",
    paused: "本轮回答已暂停，可以继续提问。",
    incomplete: "回答未完成。",
    failureReason: "失败原因",
    phases: { starting: "正在启动 Agent", thinking: "正在思考", reading: "正在阅读证据", searching: "正在搜索", generating: "正在生成回答", retrying: "正在尝试备用模型" } as Record<string, string>,
    resize: "调整 Viki 窗口大小",
    enterFullscreen: "进入全屏",
    exitFullscreen: "退出全屏",
    agentCli: "执行方式",
    model: "模型",
    savedModel: "已保存模型",
    chooseModel: "选择模型",
    noModels: "暂无可用模型",
    agentSettings: "Agent 与模型",
    cliDefault: "CLI 默认",
    currentCli: "本轮",
    nextCli: "下一轮",
    imageDetail: "打开图片详情",
    closeImage: "关闭图片详情",
    pet: "Viki 宠物",
    history: "会话历史",
    newConversation: "新建会话",
    deleteConversation: "删除会话",
    conversations: "会话",
    copyAnswer: "复制整个回答",
    copied: "已复制",
    exportConversation: "导出整个会话",
    exportLocal: "导出到本地",
    exportNote: "导出到笔记",
    webSearch: "联网搜索",
    webSearchOn: "已开启联网搜索",
    webSearchOff: "已关闭联网搜索",
    galaxyScope: "知识星系范围",
    allGalaxies: "全部知识星系",
    selectedGalaxies: "已选知识星系",
    galaxyCount: "个星系",
    user: "用户",
    assistant: "Viki",
    retry: "请稍后重试。"
  }
} as const;

function GalaxyScopePicker({
  galaxies,
  selected,
  open,
  onOpenChange,
  onChange,
  containerRef,
  labels,
  full = false
}: {
  galaxies: UniverseSummary[];
  selected: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (selected: string[]) => void;
  containerRef: RefObject<HTMLDivElement | null>;
  labels: { scope: string; all: string; selected: string; count: string };
  full?: boolean;
}) {
  const allSelected = galaxies.length > 0 && selected.length === galaxies.length;
  const selectionLabel = allSelected
    ? labels.all
    : selected.length === 1 ? selected[0] : `${selected.length} ${labels.count}`;
  return (
    <div className={`viki-galaxy-picker ${full ? "is-full" : ""}`} ref={containerRef}>
      <button
        className="viki-galaxy-toggle"
        type="button"
        aria-label={`${labels.scope}: ${selectionLabel}`}
        title={labels.scope}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <Layers3 size={15} aria-hidden="true" />
        <span>{selectionLabel}</span>
      </button>
      {open ? (
        <div className="viki-galaxy-menu" role="dialog" aria-label={labels.scope}>
          <strong>{labels.selected}</strong>
          <label className="viki-galaxy-option is-all">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => onChange(galaxies.map((item) => item.name))}
            />
            <span>{labels.all}</span>
            <small>{galaxies.length}</small>
          </label>
          <div className="viki-galaxy-options">
            {galaxies.map((galaxy) => {
              const checked = selected.includes(galaxy.name);
              return (
                <label className="viki-galaxy-option" key={galaxy.name}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={checked && selected.length === 1}
                    onChange={() => onChange(checked
                      ? selected.filter((item) => item !== galaxy.name)
                      : [...selected, galaxy.name])}
                  />
                  <span>{galaxy.name}</span>
                  <small>{galaxy.wiki}</small>
                </label>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function Viki({ language, onOpenDocument, standalone = false }: { language: Language; onOpenDocument: (path: string) => void; standalone?: boolean }) {
  const l = copy[language];
  const [windowOpen, setOpen] = useState(false);
  const [windowFullscreen, setFullscreen] = useState(false);
  const open = standalone || windowOpen;
  const fullscreen = standalone || windowFullscreen;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [pets, setPets] = useState<PetAppearance[]>([]);
  const [petId, setPetId] = useState("");
  const [petMenuOpen, setPetMenuOpen] = useState(false);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const [exportMenuConversationId, setExportMenuConversationId] = useState<string | null>(null);
  const [chatState, setChatState] = useState<VikiChatState>(() => initialChatState());
  const [questions, setQuestions] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<(AnswerStream & { conversationId: string }) | null>(null);
  const [activeRequest, setActiveRequestState] = useState<ActiveRequest | null>(null);
  const [webSearch, setWebSearch] = useState(() => initialWebSearch());
  const [galaxies, setGalaxies] = useState<UniverseSummary[]>([]);
  const previousVisibleGalaxies = useRef<string[] | null>(null);
  const [selectedGalaxies, setSelectedGalaxies] = useState<string[]>([]);
  const [galaxyMenuOpen, setGalaxyMenuOpen] = useState(false);
  const [thinkingStep, setThinkingStep] = useState(0);
  const [copiedAnswer, setCopiedAnswer] = useState("");
  const [conversationErrors, setConversationErrors] = useState<Record<string, string>>({});
  const [openedImage, setOpenedImage] = useState<OpenedImage | null>(null);
  const [viewport, setViewport] = useState(() => currentViewport());
  const [position, setPositionState] = useState<VikiPosition>(() => initialPosition());
  const [panelSize, setPanelSizeState] = useState<VikiPanelSize>(() => initialPanelSize());
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [dragDirection, setDragDirection] = useState<"left" | "right">("right");
  const [hovered, setHovered] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const followAnswerRef = useRef(true);
  const answerSubscriptionRef = useRef<AbortController | null>(null);
  const petPickerRef = useRef<HTMLDivElement>(null);
  const sessionPickerRef = useRef<HTMLDivElement>(null);
  const agentPickerRef = useRef<HTMLDivElement>(null);
  const galaxyPickerRef = useRef<HTMLDivElement>(null);
  const positionRef = useRef(position);
  const panelSizeRef = useRef(panelSize);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const resizeRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
    xDirection: 1 | -1;
    yDirection: 1 | -1;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const requestVersionRef = useRef(0);
  const resumedJobRef = useRef("");
  const activeRequestRef = useRef<ActiveRequest | null>(null);
  const composingRef = useRef(false);

  const conversation = chatState.conversations.find((item) => item.id === chatState.activeId) || chatState.conversations[0];
  const messages = conversation?.messages || [];
  const visibleDraft = draft?.conversationId === conversation?.id ? draft : null;
  const visibleRequest = activeRequest?.conversationId === conversation?.id ? activeRequest : null;
  const requestConversationId = activeRequest?.conversationId || (agent?.busy ? String(agent.activeJob?.meta?.conversationId || "") : "");
  const serviceBusy = busy || agent?.busy === true;
  const conversationBusy = serviceBusy && requestConversationId === conversation?.id;
  const canPause = conversationBusy && !!visibleRequest?.jobId;
  const question = questions[conversation?.id] || "";
  const error = conversationErrors[conversation?.id] || "";
  const setQuestion = (value: string) => setQuestions((current) => ({ ...current, [conversation.id]: value }));
  const setError = (value: string, conversationId = conversation.id) => setConversationErrors((current) => ({ ...current, [conversationId]: value }));

  const setActiveRequest = (value: ActiveRequest | null) => {
    activeRequestRef.current = value;
    setActiveRequestState(value);
  };

  const setPosition = (value: VikiPosition) => {
    positionRef.current = value;
    setPositionState(value);
  };

  const setPanelSize = (value: VikiPanelSize) => {
    panelSizeRef.current = value;
    setPanelSizeState(value);
  };

  useEffect(() => {
    Promise.all([
      localApi.vikiAgent(),
      localApi.agentPreferences().catch(() => null)
    ]).then(async ([nextAgent, remotePreferences]) => {
      setAgent(nextAgent);
      const saved = mergedVikiPreferences(remotePreferences);
      const nextProvider = selectInitialProvider(nextAgent, saved.provider);
      setProvider(nextProvider);
      setModel(selectInitialModel(nextProvider, saved.models));
      const preferredProvider = saved.provider || nextProvider;
      cacheVikiPreferences(preferredProvider, saved.models);
      if (!remotePreferences?.viki.provider) void localApi.saveAgentPreferences({
        viki: { provider: preferredProvider, models: saved.models }
      }).catch(() => {});
      setBusy(nextAgent.busy);
      const pending = chatState.conversations.find((item) => item.pendingJobId);
      const active = nextAgent.activeJob || (pending?.pendingJobId ? await localApi.job(pending.pendingJobId).catch(() => null) : null);
      const conversationId = String(active?.meta?.conversationId || "");
      if (active && resumedJobRef.current !== active.id) {
        resumedJobRef.current = active.id;
        if (conversationId && chatState.conversations.some((item) => item.id === conversationId)) {
          const resumed = {
            jobId: active.id,
            conversationId,
            provider: String(active.meta.provider || nextAgent.provider || ""),
            model: String(active.meta.model || ""),
            webSearch: active.meta.webSearch === true,
            galaxies: Array.isArray(active.meta.galaxies) ? active.meta.galaxies.map(String) : []
          };
          setActiveRequest(resumed);
          void consumeAnswer(active, resumed);
        } else {
          void waitForJob(active)
            .catch(() => undefined)
            .finally(() => localApi.vikiAgent().then((latest) => {
              setAgent(latest);
              setBusy(latest.busy);
            }).catch(() => setBusy(false)));
        }
      }
    }).catch(() => {
      setAgent({
        available: false,
        provider: "",
        label: "",
        defaultProvider: "",
        providers: [],
        message: l.unavailable,
        busy: false,
        maintenanceBusy: false,
        activeJob: null,
        activeMaintenanceJob: null
      });
      setProvider("");
      setModel("");
    });
  }, [l.unavailable]);

  useEffect(() => {
    if (standalone) return;
    localApi.pets().then(({ pets: nextPets }) => {
      setPets(nextPets);
      setPetId(selectInitialPet(nextPets));
    }).catch(() => {
      setPets([]);
      setPetId("");
    });
  }, [standalone]);

  useEffect(() => {
    let cancelled = false;
    let revision = 0;
    const refresh = () => {
      const request = ++revision;
      void localApi.universes().then(({ universes }) => {
        if (cancelled || request !== revision) return;
        const visible = universes.filter((item) => !item.hidden);
        const names = visible.map((item) => item.name);
        const previous = previousVisibleGalaxies.current;
        previousVisibleGalaxies.current = names;
        setGalaxies(visible);
        setSelectedGalaxies((current) => !previous || (current.length === previous.length && current.every((name) => previous.includes(name)))
          ? names : current.filter((name) => names.includes(name)));
      }).catch(() => {});
    };
    refresh();
    window.addEventListener("my-wiki:graph-updated", refresh);
    window.addEventListener("focus", refresh);
    return () => { cancelled = true; window.removeEventListener("my-wiki:graph-updated", refresh); window.removeEventListener("focus", refresh); };
  }, [open]);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => { void localApi.vikiAgent().then((next) => { if (!cancelled) setAgent(next); }).catch(() => {}); };
    const applyPreferences = (event: Event) => {
      const preferences = (event as CustomEvent<AgentPreferences>).detail;
      if (!preferences?.viki) return;
      const next = preferences.viki;
      setProvider(next.provider);
      setModel(next.models[next.provider] || "");
      cacheVikiPreferences(next.provider, next.models);
      refresh();
    };
    window.addEventListener("my-wiki:providers-updated", refresh);
    window.addEventListener("my-wiki:agent-preferences-updated", applyPreferences);
    return () => { cancelled = true; window.removeEventListener("my-wiki:providers-updated", refresh); window.removeEventListener("my-wiki:agent-preferences-updated", applyPreferences); };
  }, []);

  useEffect(() => {
    if (!petMenuOpen && !sessionMenuOpen && !exportMenuConversationId && !agentMenuOpen && !galaxyMenuOpen) return;
    const closeMenu = (event: PointerEvent) => {
      if (!petPickerRef.current?.contains(event.target as Node)) setPetMenuOpen(false);
      if (!sessionPickerRef.current?.contains(event.target as Node)) setSessionMenuOpen(false);
      if (!(event.target as Element).closest?.(".viki-export-picker")) setExportMenuConversationId(null);
      if (!agentPickerRef.current?.contains(event.target as Node)) setAgentMenuOpen(false);
      if (!galaxyPickerRef.current?.contains(event.target as Node)) setGalaxyMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeMenu);
    return () => document.removeEventListener("pointerdown", closeMenu);
  }, [petMenuOpen, sessionMenuOpen, exportMenuConversationId, agentMenuOpen, galaxyMenuOpen]);

  useEffect(() => {
    if (!agentMenuOpen) return;
    const menu = agentPickerRef.current?.querySelector('[role="menu"]');
    const selected = menu?.querySelector<HTMLButtonElement>('[aria-checked="true"]') || menu?.querySelector<HTMLButtonElement>('button');
    selected?.focus({ preventScroll: true });
    selected?.scrollIntoView({ block: "nearest" });
  }, [agentMenuOpen]);

  useEffect(() => {
    persistChatState(chatState);
  }, [chatState]);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, conversationBusy, open]);

  useEffect(() => {
    if (open && followAnswerRef.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [visibleDraft, open]);

  useEffect(() => () => {
    requestVersionRef.current += 1;
    answerSubscriptionRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!fullscreen) return;
    const previousOverflow = document.body.style.overflow;
    const exitOnEscape = (event: KeyboardEvent) => {
      if (!standalone && event.key === "Escape" && !openedImage && !document.body.classList.contains("has-markdown-workspace") && !document.body.classList.contains("has-document-preview")) setFullscreen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", exitOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", exitOnEscape);
    };
  }, [fullscreen, openedImage, standalone]);

  useEffect(() => {
    if (!standalone || !sidebarOpen) return;
    const sidebar = sidebarRef.current;
    const background = sidebar?.parentElement?.querySelectorAll("header, .viki-conversation, .viki-composer");
    background?.forEach((element) => element.setAttribute("inert", ""));
    const controls = () => [...(sidebar?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])];
    controls()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setSidebarOpen(false); }
      if (event.key !== "Tab") return;
      const buttons = controls();
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    sidebar?.addEventListener("keydown", onKeyDown);
    return () => {
      background?.forEach((element) => element.removeAttribute("inert"));
      sidebar?.removeEventListener("keydown", onKeyDown);
      sidebarToggleRef.current?.focus({ preventScroll: true });
    };
  }, [standalone, sidebarOpen]);

  useEffect(() => {
    setThinkingStep(0);
    if (!conversationBusy) return;
    const timer = window.setInterval(() => {
      setThinkingStep((current) => (current + 1) % copy[language].thinking.length);
    }, 4200);
    return () => window.clearInterval(timer);
  }, [conversationBusy, conversation?.id, language]);

  useEffect(() => {
    const onResize = () => {
      const nextViewport = currentViewport();
      setViewport(nextViewport);
      const nextPanelSize = clampPanelSize(panelSizeRef.current, nextViewport);
      setPanelSize(nextPanelSize);
      persistPanelSize(nextPanelSize);
      const next = positionOnEdge(positionRef.current, positionRef.current.edge, nextViewport);
      setPosition(next);
      persistPosition(next);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const history = useMemo(() => messages.filter((message) => !message.contextExcluded).slice(-8).map((message) => ({
    role: message.role,
    content: message.content.slice(0, CONTEXT_MESSAGE_CHARS),
    contextReceipt: message.contextReceipt
  })), [messages]);

  const consumeAnswer = async (initialJob: Job, request: ActiveRequest) => {
    const requestVersion = ++requestVersionRef.current;
    answerSubscriptionRef.current?.abort();
    const subscription = new AbortController();
    answerSubscriptionRef.current = subscription;
    setChatState((current) => ({ ...current, conversations: current.conversations.map((item) =>
      item.id === request.conversationId ? { ...item, pendingJobId: initialJob.id } : item) }));
    let latest = initialJob.stream || { text: "", phase: "starting", revision: 0 };
    let renderTimer: ReturnType<typeof setTimeout> | undefined;
    const update = (state: AnswerStream) => {
      latest = state;
      if (renderTimer !== undefined) return;
      renderTimer = setTimeout(() => {
        renderTimer = undefined;
        if (requestVersionRef.current === requestVersion) setDraft({ ...latest, conversationId: request.conversationId });
      }, 50);
    };
    update(latest);
    setBusy(true);
    try {
      const complete = await waitForAnswer(initialJob, update, subscription.signal);
      if (requestVersionRef.current !== requestVersion) return;
      if (complete.status === "complete") {
        const answer = complete.result as AgentAnswer;
        appendConversationMessage(request.conversationId, {
          id: complete.id, role: "assistant", content: answer.answerMarkdown,
          sources: answer.sources, images: answer.images, contextReceipt: answer.contextReceipt
        });
      } else {
        const partial = complete.stream?.text || latest.text;
        appendConversationMessage(request.conversationId, {
          id: complete.id, role: "assistant", contextExcluded: true,
          content: [partial, complete.status === "cancelled" ? l.paused : l.incomplete,
            complete.status === "failed" && complete.error ? `${l.failureReason}: ${complete.error}` : ""].filter(Boolean).join("\n\n")
        });
        if (complete.status === "failed") setError(`${complete.error} ${l.retry}`, request.conversationId);
      }
      const nextAgent = await localApi.vikiAgent().catch(() => null);
      if (nextAgent && requestVersionRef.current === requestVersion) setAgent(nextAgent);
    } catch (nextError) {
      if (requestVersionRef.current === requestVersion) setError(`${errorMessage(nextError)} ${l.retry}`, request.conversationId);
    } finally {
      clearTimeout(renderTimer);
      if (requestVersionRef.current === requestVersion) {
        setDraft(null);
        setBusy(false);
        setActiveRequest(null);
      }
    }
  };

  const ask = async () => {
    const value = question.trim();
    if (!value || !provider || !modelSelection.selected || !agent?.providers.some((item) => item.provider === provider) || selectedGalaxies.length === 0 || busy || activeRequestRef.current || agent?.busy || agent?.available !== true || !conversation) return;
    const conversationId = conversation.id;
    const requestProvider = provider;
    const requestModel = modelSelection.selected;
    const requestWebSearch = webSearch;
    const requestGalaxies = [...selectedGalaxies];
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content: value };
    appendConversationMessage(conversationId, userMessage, value);
    setQuestion("");
    setError("");
    setBusy(true);
    // Bind the submitting state before the server assigns a job ID.
    const pendingRequest = { jobId: "", conversationId, provider: requestProvider, model: requestModel, webSearch: requestWebSearch, galaxies: requestGalaxies };
    setActiveRequest(pendingRequest);
    try {
      const initialJob = await localApi.ask(value, history, language, requestProvider, requestModel, conversationId, requestWebSearch, requestGalaxies);
      const request = { ...pendingRequest, jobId: initialJob.id };
      setActiveRequest(request);
      await consumeAnswer(initialJob, request);
    } catch (nextError) {
      setBusy(false);
      setActiveRequest(null);
      setError(`${errorMessage(nextError)} ${l.retry}`, conversationId);
      window.dispatchEvent(new Event("my-wiki:graph-updated"));
    }
  };

  const pauseAnswer = async () => {
    const request = activeRequestRef.current;
    if (!request?.jobId || request.conversationId !== conversation.id) return;
    setError("", request.conversationId);
    try {
      await localApi.cancelQuery(request.jobId);
      // The terminal event (or polling recovery) owns the single final message.
    } catch (nextError) {
      setError(`${errorMessage(nextError)} ${l.retry}`, request.conversationId);
      const nextAgent = await localApi.vikiAgent().catch(() => null);
      if (nextAgent) {
        setAgent(nextAgent);
        setBusy(nextAgent.busy);
      }
    }
  };

  const changeModel = (nextModel: string) => {
    setModel(nextModel);
    setError("");
    persistModel(provider, nextModel);
    setAgentMenuOpen(false);
    agentPickerRef.current?.querySelector<HTMLButtonElement>(".viki-agent-toggle")?.focus();
  };

  const appendConversationMessage = (conversationId: string, message: ChatMessage, firstQuestion = "") => {
    setChatState((current) => ({
      ...current,
      conversations: current.conversations.map((item) => item.id === conversationId
        ? {
            ...item,
            title: item.title || conversationTitle(firstQuestion),
            updatedAt: new Date().toISOString(),
            pendingJobId: item.pendingJobId === message.id ? undefined : item.pendingJobId,
            messages: [...item.messages.filter((existing) => existing.id !== message.id), message].slice(-MAX_MESSAGES_PER_CONVERSATION)
          }
        : item)
    }));
  };

  const newConversation = () => {
    setSidebarOpen(false);
    if (conversation && conversation.messages.length === 0) {
      setQuestion("");
      setError("");
      setSessionMenuOpen(false);
      return;
    }
    const next = createConversation();
    setChatState((current) => ({
      activeId: next.id,
      conversations: [next, ...current.conversations].slice(0, MAX_CONVERSATIONS)
    }));
    setSessionMenuOpen(false);
  };

  const openConversation = (conversationId: string) => {
    setSidebarOpen(false);
    followAnswerRef.current = true;
    setChatState((current) => ({ ...current, activeId: conversationId }));
    setSessionMenuOpen(false);
  };

  const deleteConversation = (conversationId: string) => {
    if (activeRequest?.conversationId === conversationId) return;
    setChatState((current) => {
      const remaining = current.conversations.filter((item) => item.id !== conversationId);
      const conversations = remaining.length > 0 ? remaining : [createConversation()];
      return {
        conversations,
        activeId: current.activeId === conversationId ? conversations[0].id : current.activeId
      };
    });
  };

  const copyAnswer = async (messageId: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedAnswer(messageId);
      window.setTimeout(() => setCopiedAnswer((current) => current === messageId ? "" : current), 1600);
    } catch (nextError) {
      setError(`${errorMessage(nextError)} ${l.retry}`);
    }
  };

  const exportConversationLocally = async (target: VikiConversation | undefined = conversation) => {
    if (!target || target.messages.length === 0) return;
    const labels = {
      user: l.user,
      assistant: l.assistant,
      evidence: l.sources,
      untitled: l.newConversation
    };
    const bundle = conversationExportBundle(target, labels);
    const blob = bundle.images.length > 0
      ? await localApi.exportConversationBundle(bundle)
      : new Blob([conversationToMarkdown(target, labels)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = bundle.images.length > 0 ? bundle.archiveFilename : conversationFilename(target.title || "viki-conversation");
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setExportMenuConversationId(null);
  };

  const exportConversationToNote = async (target: VikiConversation | undefined = conversation) => {
    if (!target || target.messages.length === 0) return;
    const note = await localApi.createNoteFromViki(conversationNoteBundle(target, {
      user: l.user,
      assistant: l.assistant,
      evidence: l.sources,
      untitled: l.newConversation
    }));
    setExportMenuConversationId(null);
    setFullscreen(false);
    setOpen(false);
    window.dispatchEvent(new CustomEvent("my-wiki:open-quick-note", { detail: { path: note.path } }));
  };

  const startDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: positionRef.current.x,
      originY: positionRef.current.y,
      moved: false
    };
    setDragging(true);
  };

  const moveDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.hypot(dx, dy) > 3) drag.moved = true;
    if (Math.abs(dx) > 0.5) setDragDirection(dx < 0 ? "left" : "right");
    setPosition({
      x: clamp(drag.originX + dx, EDGE_GAP, viewport.width - LAUNCHER_SIZE - EDGE_GAP),
      y: clamp(drag.originY + dy, EDGE_GAP, viewport.height - LAUNCHER_SIZE - EDGE_GAP),
      edge: positionRef.current.edge
    });
  };

  const endDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const snapped = snapToNearestEdge(positionRef.current, viewport);
    setPosition(snapped);
    persistPosition(snapped);
    suppressClickRef.current = drag.moved;
    dragRef.current = null;
    setDragging(false);
    window.setTimeout(() => { suppressClickRef.current = false; }, 0);
  };

  const startResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const directions = vikiPanelDirections(positionRef.current, viewport);
    resizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: panelSizeRef.current.width,
      startHeight: panelSizeRef.current.height,
      ...directions
    };
    setResizing(true);
  };

  const moveResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    setPanelSize(clampPanelSize({
      width: resize.startWidth + (event.clientX - resize.startX) * resize.xDirection,
      height: resize.startHeight + (event.clientY - resize.startY) * resize.yDirection
    }, viewport));
  };

  const endResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    persistPanelSize(panelSizeRef.current);
    resizeRef.current = null;
    setResizing(false);
  };

  const toggleOpen = () => {
    if (suppressClickRef.current) return;
    setOpen((value) => !value);
  };

  const closeViki = () => {
    setFullscreen(false);
    setOpen(false);
  };

  const panelDirections = vikiPanelDirections(position, viewport);
  const panelOffset = vikiPanelOffset(position, viewport, panelSize);
  const resizeCorner = `${panelDirections.yDirection === 1 ? "bottom" : "top"}-${panelDirections.xDirection === 1 ? "right" : "left"}`;
  const providerLabel = agent?.providers.find((item) => item.provider === provider)?.label || provider || l.agentSettings;
  const selectedProvider = agent?.providers.find((item) => item.provider === provider);
  const modelSelection = vikiModelSelection(selectedProvider, model);
  const modelLabel = modelSelection.label;
  const currentSelection = visibleRequest
    ? agentSelectionLabel(agent, visibleRequest.provider, visibleRequest.model, l.cliDefault)
    : "";
  const nextSelection = agentSelectionLabel(agent, provider, model, l.cliDefault);
  const galaxyScopeLabel = selectedGalaxies.length === galaxies.length ? l.allGalaxies : selectedGalaxies.join(", ");
  const pet = pets.find((item) => item.id === petId) || pets[0];
  const petState: PetAnimationState = dragging
    ? dragDirection === "left" ? "running-left" : "running-right"
    : conversationBusy ? "working"
      : error ? "failed"
        : agent?.available === false ? "waiting"
          : hovered ? "waving" : "idle";
  const launcherPetSize = viewport.width <= 600 ? 48 : 72;
  const launcherPetOffset = pet ? petViewportOffset(pet, position, viewport, launcherPetSize) : { x: 0, y: 0 };

  return (
    <aside
      className={`viki ${open ? "is-open" : ""} ${fullscreen ? "is-fullscreen" : ""} ${standalone ? "is-standalone" : ""} ${dragging ? "is-dragging" : ""} ${resizing ? "is-resizing" : ""}`}
      aria-live="polite"
      style={fullscreen ? undefined : { left: position.x, top: position.y }}
    >
      {open ? (
        <section
          className={`viki-panel has-resize-${resizeCorner} ${fullscreen ? "is-fullscreen" : ""}`}
          aria-label="Viki"
          style={fullscreen ? undefined : { left: panelOffset.x, top: panelOffset.y, width: panelSize.width, height: panelSize.height }}
        >
          {standalone && sidebarOpen ? <div className="viki-sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-hidden="true" /> : null}
          <nav className={`viki-fullscreen-sidebar ${sidebarOpen ? "is-expanded" : ""}`} aria-label={l.history}
            ref={sidebarRef} role={standalone ? "dialog" : undefined} aria-modal={standalone && sidebarOpen ? true : undefined}>
            <div className="viki-fullscreen-sidebar-header">
              <strong>Viki</strong>
              {standalone ? <button type="button" aria-label={language === "zh" ? "关闭会话历史" : "Close history"} onClick={() => setSidebarOpen(false)}><X size={20} /></button> : null}
              <button type="button" aria-label={l.newConversation} title={l.newConversation} onClick={newConversation}>
                <MessageSquarePlus size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="viki-session-list" onWheel={(event) => event.stopPropagation()}>
              {[...chatState.conversations]
                .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                .map((item) => (
                  <div className="viki-session-item" data-active={item.id === conversation?.id} key={item.id}>
                    <button type="button" aria-current={item.id === conversation?.id ? "page" : undefined} onClick={() => openConversation(item.id)}>
                      <strong>{item.title || l.newConversation}</strong>
                      <span>{formatConversationTime(item.updatedAt, language)}</span>
                    </button>
                    <div className="viki-session-actions">
                      <div className="viki-export-picker">
                        <button
                          className="viki-session-export"
                          type="button"
                          aria-label={l.exportConversation}
                          title={l.exportConversation}
                          aria-haspopup="menu"
                          aria-expanded={exportMenuConversationId === item.id}
                          disabled={item.messages.length === 0}
                          onClick={() => setExportMenuConversationId((current) => current === item.id ? null : item.id)}
                        >
                          <Download size={13} aria-hidden="true" />
                        </button>
                        {exportMenuConversationId === item.id ? (
                          <div className="viki-export-menu is-sidebar" role="menu" aria-label={l.exportConversation}>
                            <button type="button" role="menuitem" onClick={() => void exportConversationLocally(item).catch((nextError) => setError(`${errorMessage(nextError)} ${l.retry}`))}>
                              <HardDriveDownload size={15} />{l.exportLocal}
                            </button>
                            {!standalone ? <button type="button" role="menuitem" onClick={() => void exportConversationToNote(item).catch((nextError) => setError(`${errorMessage(nextError)} ${l.retry}`))}>
                              <NotebookPen size={15} />{l.exportNote}
                            </button> : null}
                          </div>
                        ) : null}
                      </div>
                      <button
                        className="viki-session-delete"
                        type="button"
                        aria-label={l.deleteConversation}
                        title={l.deleteConversation}
                        disabled={activeRequest?.conversationId === item.id}
                        onClick={() => deleteConversation(item.id)}
                      >
                        <Trash2 size={13} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </nav>
          <header>
            <div className="viki-identity">
              {standalone ? <button type="button" ref={sidebarToggleRef} aria-label={l.history} aria-expanded={sidebarOpen} onClick={() => setSidebarOpen((value) => !value)}><History size={20} /></button> : null}
              <strong>Viki</strong>
              {!fullscreen && pets.length ? (
                <div className="viki-pet-picker" ref={petPickerRef}>
                  <button
                    className="viki-pet-toggle viki-icon-tooltip"
                    type="button"
                    aria-label={l.pet}
                    data-tooltip={`${l.pet}: ${pet?.displayName || ""}`}
                    aria-expanded={petMenuOpen}
                    onClick={() => setPetMenuOpen((value) => !value)}
                  >
                    <PawPrint size={16} aria-hidden="true" />
                  </button>
                  {petMenuOpen ? (
                    <div className="viki-pet-menu" role="menu" aria-label={l.pet}>
                      {pets.map((item) => (
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={item.id === pet?.id}
                          key={item.id}
                          onClick={() => {
                            setPetId(item.id);
                            persistPet(item.id);
                            setPetMenuOpen(false);
                          }}
                        >
                          <VikiPet pet={item} state="idle" size={30} fallbackSize={16} />
                          <span>{item.displayName}</span>
                          {item.id === pet?.id ? <Check size={14} aria-hidden="true" /> : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="viki-status">
              {standalone ? <button type="button" aria-label={l.newConversation} onClick={newConversation}><MessageSquarePlus size={20} /></button> : null}
              <div className="viki-header-actions is-leading">
                {!fullscreen ? <button
                  className="viki-icon-tooltip"
                  type="button"
                  aria-label={l.newConversation}
                  data-tooltip={l.newConversation}
                  onClick={newConversation}
                >
                  <MessageSquarePlus size={16} aria-hidden="true" />
                </button> : null}
                <div className="viki-session-picker" ref={sessionPickerRef}>
                <button
                  className="viki-session-toggle viki-icon-tooltip"
                  type="button"
                  aria-label={l.history}
                  data-tooltip={l.history}
                  aria-expanded={sessionMenuOpen}
                  onClick={() => setSessionMenuOpen((value) => !value)}
                >
                  <History size={16} aria-hidden="true" />
                </button>
                {sessionMenuOpen ? (
                  <div className="viki-session-menu" role="menu" aria-label={l.history}>
                    <div className="viki-session-menu-header">
                      <strong>{l.conversations}</strong>
                      <button type="button" aria-label={l.newConversation} title={l.newConversation} onClick={newConversation}>
                        <MessageSquarePlus size={15} aria-hidden="true" />
                      </button>
                    </div>
                    <div className="viki-session-list" onWheel={(event) => event.stopPropagation()}>
                      {[...chatState.conversations]
                        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                        .map((item) => (
                          <div className="viki-session-item" data-active={item.id === conversation?.id} key={item.id}>
                            <button type="button" role="menuitemradio" aria-checked={item.id === conversation?.id} onClick={() => openConversation(item.id)}>
                              <strong>{item.title || l.newConversation}</strong>
                              <span>{formatConversationTime(item.updatedAt, language)}</span>
                            </button>
                            <button
                              className="viki-session-delete"
                              type="button"
                              aria-label={l.deleteConversation}
                              title={l.deleteConversation}
                              disabled={activeRequest?.conversationId === item.id}
                              onClick={() => deleteConversation(item.id)}
                            >
                              <Trash2 size={13} aria-hidden="true" />
                            </button>
                          </div>
                        ))}
                    </div>
                  </div>
                ) : null}
                </div>
                {!fullscreen ? <div className="viki-export-picker">
                <button
                  className="viki-icon-tooltip"
                  type="button"
                  aria-label={l.exportConversation}
                  data-tooltip={l.exportConversation}
                  aria-haspopup="menu"
                  aria-expanded={exportMenuConversationId === conversation?.id}
                  disabled={!conversation?.messages.length}
                  onClick={() => setExportMenuConversationId((current) => current === conversation?.id ? null : conversation?.id || null)}
                >
                  <Download size={16} aria-hidden="true" />
                </button>
                {exportMenuConversationId === conversation?.id ? (
                  <div className="viki-export-menu" role="menu" aria-label={l.exportConversation}>
                    <button type="button" role="menuitem" onClick={() => void exportConversationLocally().catch((nextError) => setError(`${errorMessage(nextError)} ${l.retry}`))}>
                      <HardDriveDownload size={15} />{l.exportLocal}
                    </button>
                    <button type="button" role="menuitem" onClick={() => void exportConversationToNote().catch((nextError) => setError(`${errorMessage(nextError)} ${l.retry}`))}>
                      <NotebookPen size={15} />{l.exportNote}
                    </button>
                  </div>
                ) : null}
                </div> : null}
              </div>
              <div className="viki-header-selections">
                <span className={conversationBusy ? "is-busy" : ""}>{conversationBusy ? l.busy : l.ready}</span>
              </div>
              <div className="viki-header-actions is-trailing">
                {!standalone ? <button
                  className="viki-icon-tooltip"
                  type="button"
                  aria-label={fullscreen ? l.exitFullscreen : l.enterFullscreen}
                  data-tooltip={fullscreen ? l.exitFullscreen : l.enterFullscreen}
                  aria-pressed={fullscreen}
                  onClick={() => setFullscreen((value) => !value)}
                >
                  {fullscreen ? <Minimize2 size={17} aria-hidden="true" /> : <Maximize2 size={17} aria-hidden="true" />}
                </button> : null}
                {!standalone ? <button
                  className="viki-icon-tooltip"
                  type="button"
                  aria-label={l.close}
                  data-tooltip={l.close}
                  onClick={closeViki}
                >
                  <X size={17} aria-hidden="true" />
                </button> : null}
              </div>
            </div>
          </header>

          <div className="viki-conversation" onScroll={(event) => {
            const element = event.currentTarget;
            followAnswerRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100;
          }}>
            {messages.length === 0 ? (
              <div className="viki-welcome">
                {!standalone ? <span className="viki-avatar large"><VikiPet pet={pet} state={petState} size={62} fallbackSize={27} /></span> : null}
                <p>{agent?.available === false ? agent.message || l.unavailable : l.welcome}</p>
                {providerLabel ? <small>{providerLabel} · {modelLabel}</small> : null}
              </div>
            ) : null}
            {messages.map((message) => (
              <article key={message.id} className={`viki-message is-${message.role}`}>
                <div className="viki-message-body">
                  {message.contextExcluded ? <Suspense fallback={<p>{message.content}</p>}><VikiMarkdown content={message.content} pending /></Suspense> : <ChatMarkdown
                    content={message.content}
                    images={message.images}
                    onOpenImage={setOpenedImage}
                    imageDetailLabel={l.imageDetail}
                  />}
                  {message.role === "assistant" ? (
                    <button
                      className="viki-copy-answer"
                      type="button"
                      aria-label={copiedAnswer === message.id ? l.copied : l.copyAnswer}
                      title={copiedAnswer === message.id ? l.copied : l.copyAnswer}
                      onClick={() => copyAnswer(message.id, message.content)}
                    >
                      {copiedAnswer === message.id ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                    </button>
                  ) : null}
                </div>
                {message.sources?.length ? (
                  <details className="viki-sources">
                    <summary><BookOpen size={14} />{l.sources} · {message.sources.length}</summary>
                    {message.sources.map((source) => isWebSource(source) ? (
                      <a href={source.path} target="_blank" rel="noreferrer" key={source.path}>
                        <strong>{source.title}</strong><span>{source.path}</span>
                      </a>
                    ) : <button type="button" key={source.path} onClick={() => onOpenDocument(source.path)}><strong>{source.title}</strong><span>{source.path}</span></button>)}
                  </details>
                ) : null}
              </article>
            ))}
            {visibleDraft?.text ? (
              <article className="viki-message is-assistant is-streaming" aria-busy="true">
                <div className="viki-message-body">
                  <Suspense fallback={<p>{visibleDraft.text}</p>}><VikiMarkdown content={visibleDraft.text} pending /></Suspense>
                </div>
              </article>
            ) : null}
            {conversationBusy ? (
              <div className="viki-thinking" role="status" aria-live="polite" aria-busy="true">
                <div className="viki-thinking-orbit" aria-hidden="true">
                  <span className="viki-thinking-core" />
                  <span className="viki-thinking-node is-one" />
                  <span className="viki-thinking-node is-two" />
                  <span className="viki-thinking-node is-three" />
                </div>
                <div className="viki-thinking-copy">
                  <strong>{["opencode", "deepseek-api"].includes(visibleRequest?.provider || "") && visibleDraft ? (visibleDraft.phase === "starting" && visibleRequest?.provider === "deepseek-api" ? l.busy : l.phases[visibleDraft.phase]) || l.busy : l.thinking[thinkingStep]}</strong>
                  {currentSelection ? <span>{currentSelection}{visibleRequest?.webSearch ? ` · ${l.webSearchOn}` : ""}{visibleRequest?.galaxies.length ? ` · ${visibleRequest.galaxies.join(", ")}` : ""}</span> : null}
                </div>
                {activeRequest && (provider !== activeRequest.provider || modelSelection.selected !== activeRequest.model || webSearch !== activeRequest.webSearch || !sameSelection(selectedGalaxies, activeRequest.galaxies)) ? (
                  <small>{l.nextCli}: {nextSelection}{webSearch ? ` · ${l.webSearchOn}` : ""} · {galaxyScopeLabel}</small>
                ) : null}
                <i className="viki-thinking-scan" aria-hidden="true" />
              </div>
            ) : null}
            {error ? <p className="viki-error">{error}</p> : null}
            <div ref={endRef} />
          </div>

          <div className="viki-composer">
            <textarea
              aria-label={l.placeholder}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onCompositionStart={() => { composingRef.current = true; }}
              onCompositionEnd={() => { composingRef.current = false; }}
              onKeyDown={(event) => {
                if (!standalone && shouldSubmitVikiComposer({
                  key: event.key,
                  shiftKey: event.shiftKey,
                  isComposing: composingRef.current || event.nativeEvent.isComposing,
                  keyCode: event.nativeEvent.keyCode
                })) {
                  event.preventDefault();
                  void ask();
                }
              }}
              placeholder={l.placeholder}
              rows={2}
              disabled={conversationBusy || !agent?.providers.some((item) => item.provider === provider) || agent?.available !== true}
            />
            <div className="viki-composer-toolbar">
              <div className="viki-composer-toolbar-left">
                <GalaxyScopePicker
                  galaxies={galaxies}
                  selected={selectedGalaxies}
                  open={galaxyMenuOpen}
                  onOpenChange={setGalaxyMenuOpen}
                  onChange={setSelectedGalaxies}
                  containerRef={galaxyPickerRef}
                  labels={{ scope: l.galaxyScope, all: l.allGalaxies, selected: l.selectedGalaxies, count: l.galaxyCount }}
                  full
                />
                <button
                  className={`viki-composer-web-toggle viki-icon-tooltip ${webSearch ? "is-active" : ""}`}
                  type="button"
                  aria-label={`${l.webSearch}: ${webSearch ? l.webSearchOn : l.webSearchOff}`}
                  title={`${l.webSearch}: ${webSearch ? l.webSearchOn : l.webSearchOff}`}
                  data-tooltip={`${l.webSearch}: ${webSearch ? l.webSearchOn : l.webSearchOff}`}
                  aria-pressed={webSearch}
                  onClick={() => {
                    const next = !webSearch;
                    setWebSearch(next);
                    persistWebSearch(next);
                  }}
                >
                  <Globe2 size={15} aria-hidden="true" />
                </button>
              </div>
              <div className="viki-composer-toolbar-right">
                {agent ? (
                  <div className="viki-agent-picker is-full" ref={agentPickerRef}>
                    <button
                      className="viki-agent-toggle"
                      type="button"
                      aria-label={l.model}
                      title={modelLabel || l.model}
                      aria-haspopup="menu"
                      aria-expanded={agentMenuOpen}
                      disabled={!selectedProvider || modelSelection.models.length === 0}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setAgentMenuOpen(true); }
                      }}
                      onClick={() => setAgentMenuOpen((value) => !value)}
                    >
                      <span>{modelLabel || l.chooseModel}</span><ChevronDown size={13} aria-hidden="true" />
                    </button>
                    {agentMenuOpen ? (
                      <div className="viki-agent-menu" role="menu" aria-label={l.model}
                        onWheel={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                          if (event.key === "Escape" || event.key === "Tab") {
                            setAgentMenuOpen(false);
                            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); agentPickerRef.current?.querySelector<HTMLButtonElement>(".viki-agent-toggle")?.focus(); }
                            return;
                          }
                          const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="menuitemradio"]')];
                          const index = options.indexOf(document.activeElement as HTMLButtonElement);
                          const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : event.key === "ArrowDown" ? (index + 1) % options.length : event.key === "ArrowUp" ? (index - 1 + options.length) % options.length : -1;
                          if (next >= 0) { event.preventDefault(); options[next]?.focus(); }
                        }}>
                        {modelSelection.models.map((item) => <button type="button" role="menuitemradio" key={item.id}
                          aria-checked={item.id === modelSelection.selected} tabIndex={item.id === modelSelection.selected ? 0 : -1}
                          onClick={() => changeModel(item.id)}><span>{item.label}</span>{item.id === modelSelection.selected ? <Check size={15} aria-hidden="true" /> : null}</button>)}
                        {!modelSelection.models.length ? <span className="viki-models-empty">{l.noModels}</span> : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
            <button
              className={conversationBusy ? "is-pause" : ""}
              type="button"
              aria-label={conversationBusy ? l.pause : l.send}
              title={conversationBusy ? l.pause : serviceBusy ? l.backgroundBusy : l.send}
              disabled={conversationBusy ? !canPause : serviceBusy || !question.trim() || !modelSelection.selected || !agent?.providers.some((item) => item.provider === provider) || selectedGalaxies.length === 0 || agent?.available !== true}
              onClick={() => canPause ? void pauseAnswer() : void ask()}
            >
              {conversationBusy ? <CirclePause size={19} /> : <SendHorizontal size={18} />}
            </button>
          </div>
          {!fullscreen ? <button
            className={`viki-resize-handle is-${resizeCorner}`}
            type="button"
            aria-label={l.resize}
            title={l.resize}
            onPointerDown={startResize}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
          >
            <MoveDiagonal2 size={14} aria-hidden="true" />
          </button> : null}
        </section>
      ) : null}

      {!fullscreen ? <button
        className="viki-launcher"
        type="button"
        aria-label={l.open}
        title={l.open}
        aria-expanded={open}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onClick={toggleOpen}
        onDoubleClick={() => {
          if (suppressClickRef.current) return;
          setOpen(true);
          setFullscreen(true);
        }}
      >
        <VikiPet
          pet={pet}
          state={petState}
          size={launcherPetSize}
          fallbackSize={25}
          offsetX={launcherPetOffset.x}
          offsetY={launcherPetOffset.y}
        />
      </button> : null}
      {openedImage ? (
        <ImageLightbox image={openedImage} closeLabel={l.closeImage} onClose={() => setOpenedImage(null)} />
      ) : null}
    </aside>
  );
}

const petAnimations: Record<PetAnimationState, { row: number; durations: number[] }> = {
  idle: { row: 0, durations: [280, 110, 110, 140, 140, 320] },
  "running-right": { row: 1, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  "running-left": { row: 2, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  waving: { row: 3, durations: [140, 140, 140, 280] },
  failed: { row: 5, durations: [140, 140, 140, 140, 140, 140, 140, 240] },
  waiting: { row: 6, durations: [150, 150, 150, 150, 150, 260] },
  working: { row: 7, durations: [120, 120, 120, 120, 120, 220] }
};

function VikiPet({ pet, state, size, fallbackSize, offsetX = 0, offsetY = 0 }: {
  pet?: PetAppearance;
  state: PetAnimationState;
  size: number;
  fallbackSize: number;
  offsetX?: number;
  offsetY?: number;
}) {
  const animation = petAnimations[state];
  const reducedMotion = useReducedMotion();
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    setFrame(0);
    if (!pet || reducedMotion) return;
    let current = 0;
    let timeout = window.setTimeout(tick, animation.durations[current]);
    function tick() {
      current = (current + 1) % animation.durations.length;
      setFrame(current);
      timeout = window.setTimeout(tick, animation.durations[current]);
    }
    return () => window.clearTimeout(timeout);
  }, [animation, pet, reducedMotion]);

  if (!pet) return <Bot size={fallbackSize} aria-hidden="true" />;
  const scale = size / pet.cellWidth;
  const displayScale = pet.displayScale || 1;
  const displayedCellWidth = pet.cellWidth * scale * displayScale;
  const displayedCellHeight = pet.cellHeight * scale * displayScale;
  const style = {
    width: displayedCellWidth,
    height: displayedCellHeight,
    transform: `translate3d(${offsetX}px, ${offsetY}px, 0)`
  } as CSSProperties;
  const imageStyle = {
    width: pet.columns * displayedCellWidth,
    height: pet.rows * displayedCellHeight,
    imageRendering: pet.imageRendering === "smooth" ? "auto" : "pixelated",
    transform: `translate3d(${-frame * displayedCellWidth}px, ${-animation.row * displayedCellHeight}px, 0)`
  } as CSSProperties;
  return (
    <span className="viki-pet" style={style} aria-hidden="true">
      <img src={pet.spritesheetUrl} alt="" draggable={false} style={imageStyle} />
    </span>
  );
}

function VikiVaultImage({ image, onOpen, detailLabel }: {
  image: AgentAnswer["images"][number];
  onOpen: (image: OpenedImage) => void;
  detailLabel: string;
}) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (isWebImage(image)) {
      setUrl(image.path);
    } else {
      localApi.vaultFileUrl(image.path)
        .then((nextUrl) => { if (!cancelled) setUrl(nextUrl); })
        .catch(() => { if (!cancelled) setUrl(""); });
    }
    return () => { cancelled = true; };
  }, [image.path]);

  if (!url) return null;
  const open = () => onOpen({ path: image.path, caption: image.caption, url });
  return (
    <figure
      className="viki-inline-image"
      role="button"
      tabIndex={0}
      aria-label={`${detailLabel}: ${image.caption || image.path}`}
      title={detailLabel}
      onDoubleClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter") open();
      }}
    >
      <img
        src={url}
        alt={image.caption || ""}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setUrl("")}
      />
      {image.caption ? <figcaption>{image.caption}</figcaption> : null}
    </figure>
  );
}

function ImageLightbox({ image, closeLabel, onClose }: { image: OpenedImage; closeLabel: string; onClose: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return createPortal(
    <div
      className="viki-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={image.caption || image.path}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button type="button" className="viki-lightbox-close" aria-label={closeLabel} title={closeLabel} onClick={onClose}>
        <X size={22} aria-hidden="true" />
      </button>
      <figure>
        <img src={image.url} alt={image.caption || ""} />
        {image.caption ? <figcaption>{image.caption}</figcaption> : null}
      </figure>
    </div>,
    document.body
  );
}

function createConversation(): VikiConversation {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), title: "", createdAt: now, updatedAt: now, messages: [] };
}

function initialChatState(): VikiChatState {
  const fallback = createConversation();
  if (typeof window === "undefined") return { activeId: fallback.id, conversations: [fallback] };
  try {
    const stored = JSON.parse(window.localStorage.getItem(CHAT_STATE_KEY) || "null");
    const conversations: VikiConversation[] = Array.isArray(stored?.conversations)
      ? stored.conversations.slice(0, MAX_CONVERSATIONS).flatMap((item: any) => {
          const id = String(item?.id || "").trim();
          if (!id) return [];
          const createdAt = validIsoDate(item.createdAt) || new Date().toISOString();
          const updatedAt = validIsoDate(item.updatedAt) || createdAt;
          const messages = Array.isArray(item.messages)
            ? item.messages.slice(-MAX_MESSAGES_PER_CONVERSATION).flatMap(normalizeStoredMessage)
            : [];
          const pendingJobId = /^[a-f0-9-]{36}$/i.test(item.pendingJobId || "") ? item.pendingJobId : undefined;
          return [{ id, title: String(item.title || "").trim().slice(0, 80), createdAt, updatedAt, messages, pendingJobId }];
        })
      : [];
    if (conversations.length === 0) return { activeId: fallback.id, conversations: [fallback] };
    const requestedActiveId = String(stored?.activeId || "");
    return {
      activeId: conversations.some((item) => item.id === requestedActiveId) ? requestedActiveId : conversations[0].id,
      conversations
    };
  } catch {
    return { activeId: fallback.id, conversations: [fallback] };
  }
}

function normalizeStoredMessage(item: any): ChatMessage[] {
  const role = item?.role === "user" || item?.role === "assistant" ? item.role : "";
  const content = String(item?.content || "").trim().slice(0, MAX_STORED_MESSAGE_CHARS);
  if (!role || !content) return [];
  const sources = Array.isArray(item.sources)
    ? item.sources.slice(0, 20).flatMap((source: any) => {
        const path = String(source?.path || "").trim();
        const type = source?.type === "web" || /^https?:\/\//i.test(path) ? "web" as const : "vault" as const;
        return path ? [{ path, title: String(source?.title || path).trim().slice(0, 240), type }] : [];
      })
    : undefined;
  const images = Array.isArray(item.images)
    ? item.images.slice(0, 3).flatMap((image: any) => {
        const path = String(image?.path || "").trim();
        const requestedBlock = Number(image?.afterBlock);
        const lastBlock = lastMarkdownBlockIndex(content);
        const afterBlock = Number.isInteger(requestedBlock) ? clamp(requestedBlock, 0, lastBlock) : lastBlock;
        const type = image?.type === "web" || /^https?:\/\//i.test(path) ? "web" as const : "vault" as const;
        return path ? [{ path, caption: String(image?.caption || "").trim().slice(0, 500), afterBlock, type }] : [];
      })
    : undefined;
  return [{
    id: String(item.id || crypto.randomUUID()),
    role,
    content,
    sources,
    images,
    contextExcluded: Boolean(item.contextExcluded),
    contextReceipt: typeof item.contextReceipt?.question === "string" && typeof item.contextReceipt?.signature === "string"
      ? { question: item.contextReceipt.question, signature: item.contextReceipt.signature } : undefined
  }];
}

function initialWebSearch() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(WEB_SEARCH_KEY) === "true";
  } catch {
    return false;
  }
}

function persistWebSearch(value: boolean) {
  try {
    window.localStorage.setItem(WEB_SEARCH_KEY, String(value));
  } catch {
    // Storage can be unavailable in private or embedded contexts.
  }
}

function isWebSource(source: AgentAnswer["sources"][number]) {
  return source.type === "web" || /^https?:\/\//i.test(source.path);
}

function persistChatState(state: VikiChatState) {
  if (typeof window === "undefined") return;
  try {
    const active = state.conversations.find((item) => item.id === state.activeId);
    const ordered = [
      ...(active ? [active] : []),
      ...state.conversations
        .filter((item) => item.id !== active?.id)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    ].slice(0, MAX_CONVERSATIONS);
    let remaining = CHAT_STORAGE_CHAR_LIMIT;
    const compact = ordered.flatMap((item) => {
      const messages: ChatMessage[] = [];
      for (const message of item.messages.slice(-MAX_MESSAGES_PER_CONVERSATION).reverse()) {
        if (remaining <= 0) break;
        const content = message.content.slice(0, Math.min(MAX_STORED_MESSAGE_CHARS, remaining));
        if (!content) continue;
        remaining -= content.length;
        messages.unshift({
          ...message,
          content,
          images: message.images?.map(({ path, caption, afterBlock, type }) => ({ path, caption, afterBlock, type }))
        });
      }
      return messages.length || item.id === state.activeId ? [{ ...item, messages }] : [];
    });
    window.localStorage.setItem(CHAT_STATE_KEY, JSON.stringify({ activeId: state.activeId, conversations: compact }));
  } catch {
    // Conversation history is helpful but must never block Viki itself.
  }
}

function conversationTitle(question: string) {
  const firstLine = String(question || "").split(/\r?\n/, 1)[0].replace(/\s+/g, " ").trim();
  if (!firstLine) return "";
  return firstLine.length > 42 ? `${firstLine.slice(0, 42)}...` : firstLine;
}

function validIsoDate(value: unknown) {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function formatConversationTime(value: string, language: Language) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function agentModelLabel(agent: AgentInfo | null, provider: string, model: string, defaultLabel: string) {
  if (provider === "deepseek-api") defaultLabel = defaultLabel.includes("默认") ? "默认模型" : "Default model";
  const providerInfo = agent?.providers.find((item) => item.provider === provider);
  if (!model) return providerInfo?.defaultModel ? `${defaultLabel} · ${providerInfo.defaultModel}` : defaultLabel;
  return providerInfo?.models?.find((item) => item.id === model)?.label || model;
}

function agentSelectionLabel(agent: AgentInfo | null, provider: string, model: string, defaultLabel: string) {
  const providerLabel = agent?.providers.find((item) => item.provider === provider)?.label || provider;
  return providerLabel ? `${providerLabel} · ${agentModelLabel(agent, provider, model, defaultLabel)}` : "";
}

function sameSelection(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const values = new Set(left);
  return right.every((item) => values.has(item));
}

function isWebImage(image: AgentAnswer["images"][number]) {
  return image.type === "web" || /^https?:\/\//i.test(image.path);
}

function petViewportOffset(
  pet: PetAppearance,
  position: VikiPosition,
  viewport: { width: number; height: number },
  size: number
) {
  const displayScale = pet.displayScale || 1;
  const width = size * displayScale;
  const height = pet.cellHeight * (size / pet.cellWidth) * displayScale;
  const centerX = position.x + LAUNCHER_SIZE / 2;
  const centerY = position.y + LAUNCHER_SIZE / 2;
  return {
    x: clamp(0, EDGE_GAP + width / 2 - centerX, viewport.width - EDGE_GAP - width / 2 - centerX),
    y: clamp(0, EDGE_GAP + height / 2 - centerY, viewport.height - EDGE_GAP - height / 2 - centerY)
  };
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

function currentViewport() {
  if (typeof window === "undefined") return { width: 1366, height: 768 };
  return { width: window.innerWidth, height: window.innerHeight };
}

function initialPosition(): VikiPosition {
  const viewport = currentViewport();
  try {
    const stored = JSON.parse(window.localStorage.getItem(POSITION_KEY) || "null");
    if (stored && ["top", "right", "bottom", "left"].includes(stored.edge)) {
      return positionOnEdge({ x: Number(stored.x) || EDGE_GAP, y: Number(stored.y) || EDGE_GAP, edge: stored.edge }, stored.edge, viewport);
    }
  } catch {
    // Use the first-run position.
  }
  return { x: EDGE_GAP, y: viewport.height - LAUNCHER_SIZE - EDGE_GAP, edge: "bottom" };
}

function initialPanelSize(): VikiPanelSize {
  const viewport = currentViewport();
  try {
    const stored = JSON.parse(window.localStorage.getItem(PANEL_SIZE_KEY) || "null");
    if (stored && Number.isFinite(Number(stored.width)) && Number.isFinite(Number(stored.height))) {
      return clampPanelSize({ width: Number(stored.width), height: Number(stored.height) }, viewport);
    }
  } catch {
    // Use the default 4:3 panel size.
  }
  return clampPanelSize(DEFAULT_PANEL_SIZE, viewport);
}

function persistPosition(position: VikiPosition) {
  try {
    window.localStorage.setItem(POSITION_KEY, JSON.stringify(position));
  } catch {
    // Position persistence is optional.
  }
}

function persistPanelSize(size: VikiPanelSize) {
  try {
    window.localStorage.setItem(PANEL_SIZE_KEY, JSON.stringify(size));
  } catch {
    // Panel-size persistence is optional.
  }
}

function selectInitialProvider(agent: AgentInfo, preferred = readStoredProvider()) {
  const available = new Set(agent.providers.map((item) => item.provider));
  if (preferred) return preferred;
  if (agent.defaultProvider && available.has(agent.defaultProvider)) return agent.defaultProvider;
  if (available.has("opencode")) return "opencode";
  return agent.providers[0]?.provider || "";
}

function readStoredProvider() {
  try {
    return String(window.localStorage.getItem(PROVIDER_KEY) || "").trim().toLowerCase();
  } catch {
    return "";
  }
}

function selectInitialModel(provider: string, models = readStoredModels()) {
  return models[provider] || "";
}

function readStoredModels(): Record<string, string> {
  try {
    const stored = JSON.parse(window.localStorage.getItem(MODEL_KEY) || "{}");
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
    return Object.fromEntries(Object.entries(stored).flatMap(([provider, model]) => {
      const normalizedProvider = String(provider || "").trim().toLowerCase();
      const normalizedModel = String(model || "").trim();
      return normalizedProvider && normalizedModel ? [[normalizedProvider, normalizedModel]] : [];
    }));
  } catch {
    return {};
  }
}

function persistModel(provider: string, model: string) {
  const stored = readStoredModels();
  if (model) stored[provider] = model;
  else delete stored[provider];
  try {
    window.localStorage.setItem(MODEL_KEY, JSON.stringify(stored));
  } catch {
    // Model persistence is optional.
  }
  void localApi.saveAgentPreferences({ viki: { models: { [provider]: model } } }).catch(() => {});
}

function mergedVikiPreferences(remote: AgentPreferences | null) {
  if (remote?.viki.provider) return remote.viki;
  const localProvider = readStoredProvider();
  const localModels = readStoredModels();
  return {
    provider: localProvider || remote?.viki.provider || "",
    models: { ...(remote?.viki.models || {}), ...localModels }
  };
}

function cacheVikiPreferences(provider: string, models: Record<string, string>) {
  try {
    if (provider) window.localStorage.setItem(PROVIDER_KEY, provider);
    window.localStorage.setItem(MODEL_KEY, JSON.stringify(models));
  } catch {
    // Vault persistence remains available when browser storage is unavailable.
  }
}

function selectInitialPet(pets: PetAppearance[]) {
  const available = new Set(pets.map((item) => item.id));
  const stored = readStoredPet();
  if (stored && available.has(stored)) return stored;
  return pets.find((item) => item.id === "qoderwork--my-wiki")?.id || pets[0]?.id || "";
}

function readStoredPet() {
  try {
    return String(window.localStorage.getItem(PET_KEY) || "").trim();
  } catch {
    return "";
  }
}

function persistPet(petId: string) {
  try {
    window.localStorage.setItem(PET_KEY, petId);
  } catch {
    // Pet persistence is optional.
  }
}

function snapToNearestEdge(position: VikiPosition, viewport: { width: number; height: number }): VikiPosition {
  const distances: Array<[VikiEdge, number]> = [
    ["left", position.x],
    ["right", viewport.width - position.x - LAUNCHER_SIZE],
    ["top", position.y],
    ["bottom", viewport.height - position.y - LAUNCHER_SIZE]
  ];
  distances.sort((a, b) => a[1] - b[1]);
  return positionOnEdge(position, distances[0][0], viewport);
}

function positionOnEdge(position: VikiPosition, edge: VikiEdge, viewport: { width: number; height: number }): VikiPosition {
  const maxX = Math.max(EDGE_GAP, viewport.width - LAUNCHER_SIZE - EDGE_GAP);
  const maxY = Math.max(EDGE_GAP, viewport.height - LAUNCHER_SIZE - EDGE_GAP);
  return {
    x: edge === "left" ? EDGE_GAP : edge === "right" ? maxX : clamp(position.x, EDGE_GAP, maxX),
    y: edge === "top" ? EDGE_GAP : edge === "bottom" ? maxY : clamp(position.y, EDGE_GAP, maxY),
    edge
  };
}

function vikiPanelDirections(position: VikiPosition, viewport: { width: number; height: number }) {
  const preferRight = position.x + LAUNCHER_SIZE / 2 <= viewport.width / 2;
  const preferBelow = position.y + LAUNCHER_SIZE / 2 <= viewport.height / 2;
  return {
    xDirection: (preferRight ? 1 : -1) as 1 | -1,
    yDirection: (preferBelow ? 1 : -1) as 1 | -1
  };
}

function vikiPanelOffset(position: VikiPosition, viewport: { width: number; height: number }, size: VikiPanelSize) {
  const panelWidth = size.width;
  const panelHeight = size.height;
  const { xDirection, yDirection } = vikiPanelDirections(position, viewport);
  const globalX = clamp(
    xDirection === 1 ? position.x : position.x + LAUNCHER_SIZE - panelWidth,
    EDGE_GAP,
    viewport.width - panelWidth - EDGE_GAP
  );
  const globalY = clamp(
    yDirection === 1 ? position.y + LAUNCHER_SIZE + PANEL_GAP : position.y - panelHeight - PANEL_GAP,
    EDGE_GAP,
    viewport.height - panelHeight - EDGE_GAP
  );
  return { x: globalX - position.x, y: globalY - position.y };
}

function clampPanelSize(size: VikiPanelSize, viewport: { width: number; height: number }): VikiPanelSize {
  const maxWidth = Math.max(1, viewport.width - EDGE_GAP * 2);
  const maxHeight = Math.max(1, viewport.height - EDGE_GAP * 2);
  const minWidth = Math.min(MIN_PANEL_SIZE.width, maxWidth);
  const minHeight = Math.min(MIN_PANEL_SIZE.height, maxHeight);
  return {
    width: Math.round(clamp(size.width, minWidth, maxWidth)),
    height: Math.round(clamp(size.height, minHeight, maxHeight))
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function markdownBlocks(content: string) {
  const blocks: string[] = [];
  let current: string[] = [];
  let fence = "";
  const flush = () => {
    const block = current.join("\n").trim();
    if (block) blocks.push(block);
    current = [];
  };
  for (const line of content.replace(/\r\n/g, "\n").split("\n")) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/u)?.[1] || "";
    if (!fence && marker) fence = marker;
    else if (fence && marker && marker[0] === fence[0] && marker.length >= fence.length) fence = "";
    if (!fence && !line.trim()) flush();
    else current.push(line);
  }
  flush();
  return blocks;
}

function lastMarkdownBlockIndex(content: string) {
  return Math.max(0, markdownBlocks(content).length - 1);
}

function ChatMarkdown({
  content,
  images = [],
  onOpenImage,
  imageDetailLabel
}: {
  content: string;
  images?: AgentAnswer["images"];
  onOpenImage: (image: OpenedImage) => void;
  imageDetailLabel: string;
}) {
  const promoted = promoteVaultMarkdownImages(stripDanglingSourceFootnotes(content), images);
  const blocks = markdownBlocks(promoted.content);
  const imagesByBlock = new Map<number, AgentAnswer["images"]>();
  const lastBlock = Math.max(0, blocks.length - 1);
  for (const image of promoted.images) {
    const blockIndex = Number.isInteger(image.afterBlock) ? clamp(image.afterBlock, 0, lastBlock) : lastBlock;
    imagesByBlock.set(blockIndex, [...(imagesByBlock.get(blockIndex) || []), image]);
  }
  return <>{blocks.map((block, index) => {
    const markdownBlock = <Suspense fallback={<p className="viki-markdown-fallback">{block}</p>}><VikiMarkdown content={block} /></Suspense>;
    const placedImages = imagesByBlock.get(index) || [];
    return (
      <div className="viki-markdown-block" key={index}>
        {markdownBlock}
        {placedImages.map((image, imageIndex) => (
          <VikiVaultImage
            image={image}
            detailLabel={imageDetailLabel}
            onOpen={onOpenImage}
            key={`${image.path}-${imageIndex}`}
          />
        ))}
      </div>
    );
  })}</>;
}

function errorMessage(value: unknown) {
  return value instanceof Error ? value.message : String(value);
}
