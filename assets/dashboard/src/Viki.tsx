import { lazy, Suspense, type CSSProperties, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bot, BookOpen, Check, CirclePause, Copy, Download, Globe2, HardDriveDownload, History, Layers3, Maximize2, MessageSquarePlus, Minimize2, MoveDiagonal2, NotebookPen, PawPrint, SendHorizontal, Trash2, X } from "lucide-react";
import { AgentAnswer, AgentInfo, Job, localApi, PetAppearance, UniverseSummary, waitForJob } from "./api";
import { shouldSubmitVikiComposer } from "./viki-composer.js";
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
};
type VikiConversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
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
    unavailable: "Connect a signed-in Codex, OpenCode, Qoder, or Claude CLI to use Viki.",
    sources: "Evidence",
    ready: "Ready",
    busy: "Working",
    pause: "Pause current answer",
    paused: "Answer paused. You can continue with another question.",
    resize: "Resize Viki",
    enterFullscreen: "Open full screen",
    exitFullscreen: "Exit full screen",
    agentCli: "Agent CLI",
    model: "Model",
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
    unavailable: "请先安装并登录 Codex、OpenCode、Qoder 或 Claude CLI，再使用 Viki。",
    sources: "参考证据",
    ready: "已就绪",
    busy: "工作中",
    pause: "暂停当前回答",
    paused: "本轮回答已暂停，可以继续提问。",
    resize: "调整 Viki 窗口大小",
    enterFullscreen: "进入全屏",
    exitFullscreen: "退出全屏",
    agentCli: "Agent CLI",
    model: "模型",
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

export function Viki({ language }: { language: Language }) {
  const l = copy[language];
  const [open, setOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
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
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeRequest, setActiveRequestState] = useState<ActiveRequest | null>(null);
  const [webSearch, setWebSearch] = useState(() => initialWebSearch());
  const [galaxies, setGalaxies] = useState<UniverseSummary[]>([]);
  const [selectedGalaxies, setSelectedGalaxies] = useState<string[]>([]);
  const [galaxyMenuOpen, setGalaxyMenuOpen] = useState(false);
  const [thinkingStep, setThinkingStep] = useState(0);
  const [copiedAnswer, setCopiedAnswer] = useState("");
  const [error, setError] = useState("");
  const [openedImage, setOpenedImage] = useState<OpenedImage | null>(null);
  const [viewport, setViewport] = useState(() => currentViewport());
  const [position, setPositionState] = useState<VikiPosition>(() => initialPosition());
  const [panelSize, setPanelSizeState] = useState<VikiPanelSize>(() => initialPanelSize());
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [dragDirection, setDragDirection] = useState<"left" | "right">("right");
  const [hovered, setHovered] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
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
    localApi.agent().then((nextAgent) => {
      setAgent(nextAgent);
      const nextProvider = selectInitialProvider(nextAgent);
      setProvider(nextProvider);
      setModel(selectInitialModel(nextAgent, nextProvider));
      setBusy(nextAgent.busy);
      const active = nextAgent.activeJob;
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
            .finally(() => localApi.agent().then((latest) => {
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
    localApi.pets().then(({ pets: nextPets }) => {
      setPets(nextPets);
      setPetId(selectInitialPet(nextPets));
    }).catch(() => {
      setPets([]);
      setPetId("");
    });
  }, []);

  useEffect(() => {
    localApi.universes().then(({ universes }) => {
      setGalaxies(universes);
      setSelectedGalaxies(universes.map((item) => item.name));
    }).catch(() => {
      setGalaxies([]);
      setSelectedGalaxies([]);
    });
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
    persistChatState(chatState);
  }, [chatState]);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, busy, open]);

  useEffect(() => {
    if (!fullscreen) return;
    const previousOverflow = document.body.style.overflow;
    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !openedImage) setFullscreen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", exitOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", exitOnEscape);
    };
  }, [fullscreen, openedImage]);

  useEffect(() => {
    setThinkingStep(0);
    if (!busy) return;
    const timer = window.setInterval(() => {
      setThinkingStep((current) => (current + 1) % copy[language].thinking.length);
    }, 4200);
    return () => window.clearInterval(timer);
  }, [busy, language]);

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
    content: message.content
  })), [messages]);

  const consumeAnswer = async (initialJob: Job, request: ActiveRequest) => {
    const requestVersion = ++requestVersionRef.current;
    setBusy(true);
    try {
      const complete = await waitForJob(initialJob);
      if (requestVersionRef.current !== requestVersion) return;
      const answer = complete.result as AgentAnswer;
      appendConversationMessage(request.conversationId, {
        id: complete.id,
        role: "assistant",
        content: answer.answerMarkdown,
        sources: answer.sources,
        images: answer.images
      });
      setAgent(await localApi.agent());
    } catch (nextError) {
      if (requestVersionRef.current === requestVersion) setError(`${errorMessage(nextError)} ${l.retry}`);
    } finally {
      if (requestVersionRef.current === requestVersion) {
        setBusy(false);
        setActiveRequest(null);
      }
    }
  };

  const ask = async () => {
    const value = question.trim();
    if (!value || !provider || selectedGalaxies.length === 0 || busy || activeRequestRef.current || agent?.busy || agent?.available !== true || !conversation) return;
    const conversationId = conversation.id;
    const requestProvider = provider;
    const requestModel = model;
    const requestWebSearch = webSearch;
    const requestGalaxies = [...selectedGalaxies];
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content: value };
    appendConversationMessage(conversationId, userMessage, value);
    setQuestion("");
    setError("");
    setBusy(true);
    try {
      const initialJob = await localApi.ask(value, history, language, requestProvider, requestModel, conversationId, requestWebSearch, requestGalaxies);
      const request = { jobId: initialJob.id, conversationId, provider: requestProvider, model: requestModel, webSearch: requestWebSearch, galaxies: requestGalaxies };
      setActiveRequest(request);
      await consumeAnswer(initialJob, request);
    } catch (nextError) {
      setBusy(false);
      setActiveRequest(null);
      setError(`${errorMessage(nextError)} ${l.retry}`);
    }
  };

  const pauseAnswer = async () => {
    const request = activeRequestRef.current;
    if (!request) return;
    setError("");
    try {
      const paused = await localApi.cancelQuery(request.jobId);
      if (paused.cancelled) {
        requestVersionRef.current += 1;
        appendConversationMessage(request.conversationId, {
          id: crypto.randomUUID(),
          role: "assistant",
          content: l.paused,
          contextExcluded: true
        });
        setActiveRequest(null);
      }
      const nextAgent = await localApi.agent();
      setAgent(nextAgent);
      setBusy(paused.cancelled ? nextAgent.busy : true);
    } catch (nextError) {
      setError(`${errorMessage(nextError)} ${l.retry}`);
      const nextAgent = await localApi.agent().catch(() => null);
      if (nextAgent) {
        setAgent(nextAgent);
        setBusy(nextAgent.busy);
      }
    }
  };

  const changeProvider = (nextProvider: string) => {
    setProvider(nextProvider);
    setModel(selectInitialModel(agent, nextProvider));
    setError("");
    persistProvider(nextProvider);
  };

  const changeModel = (nextModel: string) => {
    setModel(nextModel);
    setError("");
    persistModel(provider, nextModel);
  };

  const appendConversationMessage = (conversationId: string, message: ChatMessage, firstQuestion = "") => {
    setChatState((current) => ({
      ...current,
      conversations: current.conversations.map((item) => item.id === conversationId
        ? {
            ...item,
            title: item.title || conversationTitle(firstQuestion),
            updatedAt: new Date().toISOString(),
            messages: [...item.messages, message].slice(-MAX_MESSAGES_PER_CONVERSATION)
          }
        : item)
    }));
  };

  const newConversation = () => {
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
    setQuestion("");
    setError("");
    setSessionMenuOpen(false);
  };

  const openConversation = (conversationId: string) => {
    setChatState((current) => ({ ...current, activeId: conversationId }));
    setError("");
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
  const providerLabel = agent?.providers.find((item) => item.provider === provider)?.label || agent?.label || "";
  const selectedProvider = agent?.providers.find((item) => item.provider === provider);
  const modelLabel = agentModelLabel(agent, provider, model, l.cliDefault);
  const currentSelection = activeRequest
    ? agentSelectionLabel(agent, activeRequest.provider, activeRequest.model, l.cliDefault)
    : "";
  const nextSelection = agentSelectionLabel(agent, provider, model, l.cliDefault);
  const galaxyScopeLabel = selectedGalaxies.length === galaxies.length ? l.allGalaxies : selectedGalaxies.join(", ");
  const pet = pets.find((item) => item.id === petId) || pets[0];
  const petState: PetAnimationState = dragging
    ? dragDirection === "left" ? "running-left" : "running-right"
    : busy || agent?.busy ? "working"
      : error ? "failed"
        : agent?.available === false ? "waiting"
          : hovered ? "waving" : "idle";
  const launcherPetSize = viewport.width <= 600 ? 48 : 72;
  const launcherPetOffset = pet ? petViewportOffset(pet, position, viewport, launcherPetSize) : { x: 0, y: 0 };

  return (
    <aside
      className={`viki ${open ? "is-open" : ""} ${fullscreen ? "is-fullscreen" : ""} ${dragging ? "is-dragging" : ""} ${resizing ? "is-resizing" : ""}`}
      aria-live="polite"
      style={fullscreen ? undefined : { left: position.x, top: position.y }}
    >
      {open ? (
        <section
          className={`viki-panel has-resize-${resizeCorner} ${fullscreen ? "is-fullscreen" : ""}`}
          aria-label="Viki"
          style={fullscreen ? undefined : { left: panelOffset.x, top: panelOffset.y, width: panelSize.width, height: panelSize.height }}
        >
          <nav className="viki-fullscreen-sidebar" aria-label={l.history}>
            <div className="viki-fullscreen-sidebar-header">
              <strong>Viki</strong>
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
                            <button type="button" role="menuitem" onClick={() => void exportConversationToNote(item).catch((nextError) => setError(`${errorMessage(nextError)} ${l.retry}`))}>
                              <NotebookPen size={15} />{l.exportNote}
                            </button>
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
              {!fullscreen ? <button
                className={`viki-web-toggle viki-icon-tooltip ${webSearch ? "is-active" : ""}`}
                type="button"
                aria-label={`${l.webSearch}: ${webSearch ? l.webSearchOn : l.webSearchOff}`}
                data-tooltip={`${l.webSearch}: ${webSearch ? l.webSearchOn : l.webSearchOff}`}
                aria-pressed={webSearch}
                onClick={() => {
                  const next = !webSearch;
                  setWebSearch(next);
                  persistWebSearch(next);
                }}
              >
                <Globe2 size={16} aria-hidden="true" />
              </button> : null}
              {!fullscreen ? <GalaxyScopePicker
                galaxies={galaxies}
                selected={selectedGalaxies}
                open={galaxyMenuOpen}
                onOpenChange={setGalaxyMenuOpen}
                onChange={setSelectedGalaxies}
                containerRef={galaxyPickerRef}
                labels={{ scope: l.galaxyScope, all: l.allGalaxies, selected: l.selectedGalaxies, count: l.galaxyCount }}
              /> : null}
              {!fullscreen && agent?.providers.length ? (
                <div className="viki-agent-picker" ref={agentPickerRef}>
                  <button
                    className="viki-agent-toggle"
                    type="button"
                    aria-label={l.agentSettings}
                    title={l.agentSettings}
                    aria-haspopup="dialog"
                    aria-expanded={agentMenuOpen}
                    onClick={() => setAgentMenuOpen((value) => !value)}
                  >
                    <span>{compactAgentSelection(providerLabel, modelLabel)}</span>
                  </button>
                  {agentMenuOpen ? (
                    <div className="viki-agent-menu" role="dialog" aria-label={l.agentSettings}>
                      <label>
                        <span>{l.agentCli}</span>
                        <select value={provider} onChange={(event) => changeProvider(event.target.value)}>
                          {agent.providers.map((item) => <option key={item.provider} value={item.provider}>{item.label}</option>)}
                        </select>
                      </label>
                      {selectedProvider ? (
                        <label>
                          <span>{l.model}</span>
                          <select value={model} onChange={(event) => changeModel(event.target.value)}>
                            <option value="">{selectedProvider.defaultModel ? `${l.cliDefault} · ${selectedProvider.defaultModel}` : l.cliDefault}</option>
                            {(selectedProvider.models || []).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                          </select>
                        </label>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <span className={busy || agent?.busy ? "is-busy" : ""}>{busy || agent?.busy ? l.busy : l.ready}</span>
              <button
                className="viki-icon-tooltip"
                type="button"
                aria-label={fullscreen ? l.exitFullscreen : l.enterFullscreen}
                data-tooltip={fullscreen ? l.exitFullscreen : l.enterFullscreen}
                aria-pressed={fullscreen}
                onClick={() => setFullscreen((value) => !value)}
              >
                {fullscreen ? <Minimize2 size={17} aria-hidden="true" /> : <Maximize2 size={17} aria-hidden="true" />}
              </button>
              <button
                className="viki-icon-tooltip"
                type="button"
                aria-label={l.close}
                data-tooltip={l.close}
                onClick={closeViki}
              >
                <X size={17} aria-hidden="true" />
              </button>
            </div>
          </header>

          <div className="viki-conversation">
            {messages.length === 0 ? (
              <div className="viki-welcome">
                <span className="viki-avatar large"><VikiPet pet={pet} state={petState} size={62} fallbackSize={27} /></span>
                <p>{agent?.available === false ? agent.message || l.unavailable : l.welcome}</p>
                {providerLabel ? <small>{providerLabel} · {modelLabel}</small> : null}
              </div>
            ) : null}
            {messages.map((message) => (
              <article key={message.id} className={`viki-message is-${message.role}`}>
                <div className="viki-message-body">
                  <ChatMarkdown
                    content={message.content}
                    images={message.images}
                    onOpenImage={setOpenedImage}
                    imageDetailLabel={l.imageDetail}
                  />
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
                    ) : <div key={source.path}><strong>{source.title}</strong><span>{source.path}</span></div>)}
                  </details>
                ) : null}
              </article>
            ))}
            {busy ? (
              <div className="viki-thinking" role="status" aria-live="polite" aria-busy="true">
                <div className="viki-thinking-orbit" aria-hidden="true">
                  <span className="viki-thinking-core" />
                  <span className="viki-thinking-node is-one" />
                  <span className="viki-thinking-node is-two" />
                  <span className="viki-thinking-node is-three" />
                </div>
                <div className="viki-thinking-copy">
                  <strong key={`${language}-${thinkingStep}`}>{l.thinking[thinkingStep]}</strong>
                  {currentSelection ? <span>{currentSelection}{activeRequest?.webSearch ? ` · ${l.webSearchOn}` : ""}{activeRequest?.galaxies.length ? ` · ${activeRequest.galaxies.join(", ")}` : ""}</span> : null}
                </div>
                {activeRequest && (provider !== activeRequest.provider || model !== activeRequest.model || webSearch !== activeRequest.webSearch || !sameSelection(selectedGalaxies, activeRequest.galaxies)) ? (
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
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onCompositionStart={() => { composingRef.current = true; }}
              onCompositionEnd={() => { composingRef.current = false; }}
              onKeyDown={(event) => {
                if (shouldSubmitVikiComposer({
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
              disabled={busy || agent?.busy || !provider || agent?.available !== true}
            />
            {fullscreen ? <div className="viki-composer-toolbar">
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
                  className={`viki-composer-web-toggle ${webSearch ? "is-active" : ""}`}
                  type="button"
                  aria-label={`${l.webSearch}: ${webSearch ? l.webSearchOn : l.webSearchOff}`}
                  title={`${l.webSearch}: ${webSearch ? l.webSearchOn : l.webSearchOff}`}
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
                {agent?.providers.length ? (
                  <div className="viki-agent-picker is-full" ref={agentPickerRef}>
                    <button
                      className="viki-agent-toggle"
                      type="button"
                      aria-label={l.agentSettings}
                      title={agentSelectionLabel(agent, provider, model, l.cliDefault)}
                      aria-haspopup="dialog"
                      aria-expanded={agentMenuOpen}
                      onClick={() => setAgentMenuOpen((value) => !value)}
                    >
                      <span>{agentSelectionLabel(agent, provider, model, l.cliDefault)}</span>
                    </button>
                    {agentMenuOpen ? (
                      <div className="viki-agent-menu" role="dialog" aria-label={l.agentSettings}>
                        <label>
                          <span>{l.agentCli}</span>
                          <select value={provider} onChange={(event) => changeProvider(event.target.value)}>
                            {agent.providers.map((item) => <option key={item.provider} value={item.provider}>{item.label}</option>)}
                          </select>
                        </label>
                        {selectedProvider ? (
                          <label>
                            <span>{l.model}</span>
                            <select value={model} onChange={(event) => changeModel(event.target.value)}>
                              <option value="">{selectedProvider.defaultModel ? `${l.cliDefault} · ${selectedProvider.defaultModel}` : l.cliDefault}</option>
                              {(selectedProvider.models || []).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                            </select>
                          </label>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div> : null}
            <button
              className={busy && activeRequest ? "is-pause" : ""}
              type="button"
              aria-label={busy && activeRequest ? l.pause : l.send}
              title={busy && activeRequest ? l.pause : l.send}
              disabled={busy ? !activeRequest : !question.trim() || !provider || selectedGalaxies.length === 0 || agent?.busy || agent?.available !== true}
              onClick={() => busy && activeRequest ? void pauseAnswer() : void ask()}
            >
              {busy && activeRequest ? <CirclePause size={19} /> : <SendHorizontal size={18} />}
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
          return [{ id, title: String(item.title || "").trim().slice(0, 80), createdAt, updatedAt, messages }];
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
  const content = String(item?.content || "").trim().slice(0, 12000);
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
    contextExcluded: Boolean(item.contextExcluded)
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
    const compact = ordered.map((item) => ({
      ...item,
      messages: item.messages.slice(-MAX_MESSAGES_PER_CONVERSATION).map((message) => ({
        ...message,
        content: message.content.slice(0, 12000),
        images: message.images?.map(({ path, caption, afterBlock, type }) => ({ path, caption, afterBlock, type }))
      }))
    }));
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
  const providerInfo = agent?.providers.find((item) => item.provider === provider);
  if (!model) return providerInfo?.defaultModel ? `${defaultLabel} · ${providerInfo.defaultModel}` : defaultLabel;
  return providerInfo?.models?.find((item) => item.id === model)?.label || model;
}

function agentSelectionLabel(agent: AgentInfo | null, provider: string, model: string, defaultLabel: string) {
  const providerLabel = agent?.providers.find((item) => item.provider === provider)?.label || provider;
  return providerLabel ? `${providerLabel} · ${agentModelLabel(agent, provider, model, defaultLabel)}` : "";
}

function compactAgentSelection(providerLabel: string, modelLabel: string) {
  const provider = String(providerLabel || "").replace(/\s+CN$/i, "").trim();
  const model = String(modelLabel || "").replace(/^CLI (?:default|默认)\s*·?\s*/i, "").trim();
  return [provider, model].filter(Boolean).join(" · ");
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

function selectInitialProvider(agent: AgentInfo) {
  const available = new Set(agent.providers.map((item) => item.provider));
  const stored = readStoredProvider();
  if (stored && available.has(stored)) return stored;
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

function persistProvider(provider: string) {
  try {
    window.localStorage.setItem(PROVIDER_KEY, provider);
  } catch {
    // Provider persistence is optional.
  }
}

function selectInitialModel(agent: AgentInfo | null, provider: string) {
  const providerInfo = agent?.providers.find((item) => item.provider === provider);
  if (!providerInfo) return "";
  const stored = readStoredModels()[provider];
  return stored && providerInfo.models?.some((item) => item.id === stored) ? stored : "";
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
  try {
    const stored = readStoredModels();
    if (model) stored[provider] = model;
    else delete stored[provider];
    window.localStorage.setItem(MODEL_KEY, JSON.stringify(stored));
  } catch {
    // Model persistence is optional.
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
  return content.replace(/\r\n/g, "\n").split(/\n{2,}/).filter(Boolean);
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
  const promoted = promoteVaultMarkdownImages(content, images);
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
