import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { Bot, BookOpen, Check, LoaderCircle, MoveDiagonal2, PawPrint, SendHorizontal, Square, X } from "lucide-react";
import { AgentAnswer, AgentInfo, localApi, PetAppearance, waitForJob } from "./api";

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
  images?: Array<{ path: string; caption: string; url: string }>;
};

const LAUNCHER_SIZE = 80;
const EDGE_GAP = 16;
const PANEL_GAP = 10;
const DEFAULT_PANEL_SIZE = { width: 640, height: 480 };
const MIN_PANEL_SIZE = { width: 480, height: 360 };
const POSITION_KEY = "my-wiki-viki-position";
const PROVIDER_KEY = "my-wiki-viki-provider";
const PET_KEY = "my-wiki-viki-pet";
const PANEL_SIZE_KEY = "my-wiki-viki-panel-size";

const copy = {
  en: {
    companion: "Knowledge companion",
    open: "Ask Viki",
    close: "Close Viki",
    welcome: "Ask me anything in your knowledge vault. I will start with Wiki pages and verify important details against raw evidence.",
    placeholder: "Ask your knowledge vault...",
    send: "Send",
    thinking: "Searching your vault",
    unavailable: "Connect a signed-in Codex, OpenCode, Qoder, or Claude CLI to use Viki.",
    sources: "Evidence",
    ready: "Ready",
    busy: "Working",
    stop: "Stop current answer",
    resize: "Resize Viki",
    agentCli: "Agent CLI",
    pet: "Viki pet",
    retry: "Please try again."
  },
  zh: {
    companion: "知识伙伴",
    open: "问 Viki",
    close: "关闭 Viki",
    welcome: "可以直接问我知识库里的任何问题。我会优先查阅 Wiki，并用 raw 原始证据核实重要信息。",
    placeholder: "向你的知识库提问...",
    send: "发送",
    thinking: "正在检索知识库",
    unavailable: "请先安装并登录 Codex、OpenCode、Qoder 或 Claude CLI，再使用 Viki。",
    sources: "参考证据",
    ready: "已就绪",
    busy: "工作中",
    stop: "停止当前回答",
    resize: "调整 Viki 窗口大小",
    agentCli: "Agent CLI",
    pet: "Viki 宠物",
    retry: "请稍后重试。"
  }
} as const;

export function Viki({ language }: { language: Language }) {
  const l = copy[language];
  const [open, setOpen] = useState(false);
  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [pets, setPets] = useState<PetAppearance[]>([]);
  const [petId, setPetId] = useState("");
  const [petMenuOpen, setPetMenuOpen] = useState(false);
  const [provider, setProvider] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [viewport, setViewport] = useState(() => currentViewport());
  const [position, setPositionState] = useState<VikiPosition>(() => initialPosition());
  const [panelSize, setPanelSizeState] = useState<VikiPanelSize>(() => initialPanelSize());
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [dragDirection, setDragDirection] = useState<"left" | "right">("right");
  const [hovered, setHovered] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const petPickerRef = useRef<HTMLDivElement>(null);
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
      setProvider(selectInitialProvider(nextAgent));
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
    if (!petMenuOpen) return;
    const closeMenu = (event: PointerEvent) => {
      if (!petPickerRef.current?.contains(event.target as Node)) setPetMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeMenu);
    return () => document.removeEventListener("pointerdown", closeMenu);
  }, [petMenuOpen]);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, busy, open]);

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

  const history = useMemo(() => messages.slice(-8).map((message) => ({
    role: message.role,
    content: message.content
  })), [messages]);

  const ask = async () => {
    const value = question.trim();
    if (!value || !provider || busy || agent?.available !== true) return;
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content: value };
    setMessages((current) => [...current, userMessage]);
    setQuestion("");
    setError("");
    setBusy(true);
    const requestVersion = ++requestVersionRef.current;
    try {
      const complete = await waitForJob(await localApi.ask(value, history, language, provider));
      if (requestVersionRef.current !== requestVersion) return;
      const answer = complete.result as AgentAnswer;
      const images = await Promise.all((answer.images || []).map(async (image) => ({
        ...image,
        url: await localApi.vaultFileUrl(image.path)
      })));
      setMessages((current) => [...current, {
        id: complete.id,
        role: "assistant",
        content: answer.answerMarkdown,
        sources: answer.sources,
        images
      }]);
      setAgent(await localApi.agent());
    } catch (nextError) {
      if (requestVersionRef.current === requestVersion) setError(`${errorMessage(nextError)} ${l.retry}`);
    } finally {
      if (requestVersionRef.current === requestVersion) setBusy(false);
    }
  };

  const cancelAnswer = async () => {
    requestVersionRef.current += 1;
    setError("");
    try {
      await localApi.cancelQuery();
      const nextAgent = await localApi.agent();
      setAgent(nextAgent);
      setBusy(nextAgent.busy);
    } catch (nextError) {
      setError(`${errorMessage(nextError)} ${l.retry}`);
      setBusy(false);
    }
  };

  const changeProvider = async (nextProvider: string) => {
    if (busy || agent?.busy) await cancelAnswer();
    setProvider(nextProvider);
    setError("");
    persistProvider(nextProvider);
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

  const panelDirections = vikiPanelDirections(position, viewport);
  const panelOffset = vikiPanelOffset(position, viewport, panelSize);
  const resizeCorner = `${panelDirections.yDirection === 1 ? "bottom" : "top"}-${panelDirections.xDirection === 1 ? "right" : "left"}`;
  const providerLabel = agent?.providers.find((item) => item.provider === provider)?.label || agent?.label || "";
  const pet = pets.find((item) => item.id === petId) || pets[0];
  const petState: PetAnimationState = dragging
    ? dragDirection === "left" ? "running-left" : "running-right"
    : busy || agent?.busy ? "working"
      : error ? "failed"
        : agent?.available === false ? "waiting"
          : hovered ? "waving" : "idle";

  return (
    <aside
      className={`viki ${open ? "is-open" : ""} ${dragging ? "is-dragging" : ""} ${resizing ? "is-resizing" : ""}`}
      aria-live="polite"
      style={{ left: position.x, top: position.y }}
    >
      {open ? (
        <section
          className={`viki-panel has-resize-${resizeCorner}`}
          aria-label="Viki"
          style={{ left: panelOffset.x, top: panelOffset.y, width: panelSize.width, height: panelSize.height }}
        >
          <header>
            <div className="viki-identity">
              <span className="viki-avatar"><VikiPet pet={pet} state={petState} size={36} fallbackSize={20} /></span>
              <div><strong>Viki</strong><span>{l.companion}</span></div>
            </div>
            <div className="viki-status">
              {pets.length ? (
                <div className="viki-pet-picker" ref={petPickerRef}>
                  <button
                    className="viki-pet-toggle"
                    type="button"
                    aria-label={l.pet}
                    title={`${l.pet}: ${pet?.displayName || ""}`}
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
              {agent?.providers.length ? (
                <select
                  className="viki-provider-select"
                  aria-label={l.agentCli}
                  title={l.agentCli}
                  value={provider}
                  onChange={(event) => void changeProvider(event.target.value)}
                >
                  {agent.providers.map((item) => <option key={item.provider} value={item.provider}>{item.label}</option>)}
                </select>
              ) : null}
              <span className={busy || agent?.busy ? "is-busy" : ""}>{busy || agent?.busy ? l.busy : l.ready}</span>
              {busy || agent?.busy ? (
                <button type="button" aria-label={l.stop} title={l.stop} onClick={() => void cancelAnswer()}><Square size={15} /></button>
              ) : null}
              <button type="button" aria-label={l.close} title={l.close} onClick={() => setOpen(false)}><X size={17} /></button>
            </div>
          </header>

          <div className="viki-conversation">
            {messages.length === 0 ? (
              <div className="viki-welcome">
                <span className="viki-avatar large"><VikiPet pet={pet} state={petState} size={62} fallbackSize={27} /></span>
                <p>{agent?.available === false ? agent.message || l.unavailable : l.welcome}</p>
                {providerLabel ? <small>{providerLabel}</small> : null}
              </div>
            ) : null}
            {messages.map((message) => (
              <article key={message.id} className={`viki-message is-${message.role}`}>
                <div className="viki-message-body"><ChatMarkdown content={message.content} /></div>
                {message.images?.length ? (
                  <div className="viki-images">
                    {message.images.map((image) => (
                      <figure key={image.path}><img src={image.url} alt={image.caption || ""} /><figcaption>{image.caption}</figcaption></figure>
                    ))}
                  </div>
                ) : null}
                {message.sources?.length ? (
                  <details className="viki-sources">
                    <summary><BookOpen size={14} />{l.sources} · {message.sources.length}</summary>
                    {message.sources.map((source) => <div key={source.path}><strong>{source.title}</strong><span>{source.path}</span></div>)}
                  </details>
                ) : null}
              </article>
            ))}
            {busy ? <div className="viki-thinking"><LoaderCircle className="spin" size={16} />{l.thinking}</div> : null}
            {error ? <p className="viki-error">{error}</p> : null}
            <div ref={endRef} />
          </div>

          <div className="viki-composer">
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void ask();
                }
              }}
              placeholder={l.placeholder}
              rows={2}
              disabled={busy || !provider || agent?.available !== true}
            />
            <button type="button" aria-label={l.send} title={l.send} disabled={!question.trim() || !provider || busy || agent?.available !== true} onClick={() => void ask()}>
              {busy ? <LoaderCircle className="spin" size={18} /> : <SendHorizontal size={18} />}
            </button>
          </div>
          <button
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
          </button>
        </section>
      ) : null}

      <button
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
        <VikiPet pet={pet} state={petState} size={72} fallbackSize={25} />
      </button>
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

function VikiPet({ pet, state, size, fallbackSize }: {
  pet?: PetAppearance;
  state: PetAnimationState;
  size: number;
  fallbackSize: number;
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
  const frameHeight = pet.cellHeight * scale;
  const style = {
    width: size,
    height: frameHeight
  } as CSSProperties;
  const imageStyle = {
    width: pet.columns * pet.cellWidth * scale,
    height: pet.rows * pet.cellHeight * scale,
    imageRendering: pet.imageRendering === "smooth" ? "auto" : "pixelated",
    transform: `translate3d(${-frame * pet.cellWidth * scale}px, ${-animation.row * pet.cellHeight * scale}px, 0)`
  } as CSSProperties;
  return (
    <span className="viki-pet" style={style} aria-hidden="true">
      <img src={pet.spritesheetUrl} alt="" draggable={false} style={imageStyle} />
    </span>
  );
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
  const maxWidth = Math.max(320, viewport.width - EDGE_GAP * 2);
  const maxHeight = Math.max(260, viewport.height - EDGE_GAP * 2);
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

function ChatMarkdown({ content }: { content: string }) {
  const blocks = content.replace(/\r\n/g, "\n").split(/\n{2,}/).filter(Boolean);
  return <>{blocks.map((block, index) => {
    const lines = block.split("\n");
    if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
      return <ul key={index}>{lines.map((line, lineIndex) => <li key={lineIndex}>{inlineMarkdown(line.replace(/^\s*[-*]\s+/, ""))}</li>)}</ul>;
    }
    const heading = block.match(/^#{1,4}\s+(.+)$/);
    if (heading) return <h4 key={index}>{inlineMarkdown(heading[1])}</h4>;
    return <p key={index}>{inlineMarkdown(block.replace(/\n/g, " "))}</p>;
  })}</>;
}

function inlineMarkdown(value: string) {
  const nodes: React.ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^)]+\))/g;
  let last = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(value.slice(last, index));
    const token = match[0];
    if (token.startsWith("`")) nodes.push(<code key={index}>{token.slice(1, -1)}</code>);
    else if (token.startsWith("**")) nodes.push(<strong key={index}>{token.slice(2, -2)}</strong>);
    else {
      const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
      if (link) nodes.push(<a key={index} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>);
    }
    last = index + token.length;
  }
  if (last < value.length) nodes.push(value.slice(last));
  return nodes;
}

function errorMessage(value: unknown) {
  return value instanceof Error ? value.message : String(value);
}
