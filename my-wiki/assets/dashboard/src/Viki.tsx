import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, BookOpen, LoaderCircle, SendHorizontal, X } from "lucide-react";
import { AgentAnswer, AgentInfo, localApi, waitForJob } from "./api";

type Language = "en" | "zh";
type VikiEdge = "top" | "right" | "bottom" | "left";
type VikiPosition = { x: number; y: number; edge: VikiEdge };
type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: AgentAnswer["sources"];
  images?: Array<{ path: string; caption: string; url: string }>;
};

const LAUNCHER_SIZE = 48;
const EDGE_GAP = 16;
const PANEL_GAP = 10;
const POSITION_KEY = "my-wiki-viki-position";
const PROVIDER_KEY = "my-wiki-viki-provider";

const copy = {
  en: {
    companion: "Knowledge companion",
    open: "Ask Viki",
    close: "Close Viki",
    welcome: "Ask me anything in your knowledge vault. I will start with Wiki pages and verify important details against raw evidence.",
    placeholder: "Ask your knowledge vault...",
    send: "Send",
    thinking: "Searching your vault",
    unavailable: "Connect a signed-in Codex, OpenCode, or Claude CLI to use Viki.",
    sources: "Evidence",
    ready: "Ready",
    busy: "Working",
    agentCli: "Agent CLI",
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
    unavailable: "请先安装并登录 Codex、OpenCode 或 Claude CLI，再使用 Viki。",
    sources: "参考证据",
    ready: "已就绪",
    busy: "工作中",
    agentCli: "Agent CLI",
    retry: "请稍后重试。"
  }
} as const;

export function Viki({ language }: { language: Language }) {
  const l = copy[language];
  const [open, setOpen] = useState(false);
  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [provider, setProvider] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [viewport, setViewport] = useState(() => currentViewport());
  const [position, setPositionState] = useState<VikiPosition>(() => initialPosition());
  const [dragging, setDragging] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const positionRef = useRef(position);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);

  const setPosition = (value: VikiPosition) => {
    positionRef.current = value;
    setPositionState(value);
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
    if (open) endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, busy, open]);

  useEffect(() => {
    const onResize = () => {
      const nextViewport = currentViewport();
      setViewport(nextViewport);
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
    try {
      const complete = await waitForJob(await localApi.ask(value, history, language, provider));
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
      setError(`${errorMessage(nextError)} ${l.retry}`);
    } finally {
      setBusy(false);
    }
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

  const toggleOpen = () => {
    if (suppressClickRef.current) return;
    setOpen((value) => !value);
  };

  const panelOffset = vikiPanelOffset(position, viewport);
  const providerLabel = agent?.providers.find((item) => item.provider === provider)?.label || agent?.label || "";

  return (
    <aside
      className={`viki ${open ? "is-open" : ""} ${dragging ? "is-dragging" : ""}`}
      aria-live="polite"
      style={{ left: position.x, top: position.y }}
    >
      {open ? (
        <section className="viki-panel" aria-label="Viki" style={{ left: panelOffset.x, top: panelOffset.y }}>
          <header>
            <div className="viki-identity">
              <span className="viki-avatar"><Bot size={20} aria-hidden="true" /></span>
              <div><strong>Viki</strong><span>{l.companion}</span></div>
            </div>
            <div className="viki-status">
              {agent?.providers.length ? (
                <select
                  className="viki-provider-select"
                  aria-label={l.agentCli}
                  title={l.agentCli}
                  value={provider}
                  disabled={busy}
                  onChange={(event) => {
                    const nextProvider = event.target.value;
                    setProvider(nextProvider);
                    persistProvider(nextProvider);
                  }}
                >
                  {agent.providers.map((item) => <option key={item.provider} value={item.provider}>{item.label}</option>)}
                </select>
              ) : null}
              <span className={busy || agent?.busy ? "is-busy" : ""}>{busy || agent?.busy ? l.busy : l.ready}</span>
              <button type="button" aria-label={l.close} title={l.close} onClick={() => setOpen(false)}><X size={17} /></button>
            </div>
          </header>

          <div className="viki-conversation">
            {messages.length === 0 ? (
              <div className="viki-welcome">
                <span className="viki-avatar large"><Bot size={27} aria-hidden="true" /></span>
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
        onClick={toggleOpen}
      >
        <Bot size={23} aria-hidden="true" />
      </button>
    </aside>
  );
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

function persistPosition(position: VikiPosition) {
  try {
    window.localStorage.setItem(POSITION_KEY, JSON.stringify(position));
  } catch {
    // Position persistence is optional.
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

function vikiPanelOffset(position: VikiPosition, viewport: { width: number; height: number }) {
  const panelWidth = Math.min(420, viewport.width - 44);
  const panelHeight = Math.min(620, viewport.height - 120);
  const preferRight = position.x + LAUNCHER_SIZE / 2 <= viewport.width / 2;
  const preferBelow = position.y + LAUNCHER_SIZE / 2 <= viewport.height / 2;
  const globalX = clamp(
    preferRight ? position.x : position.x + LAUNCHER_SIZE - panelWidth,
    EDGE_GAP,
    viewport.width - panelWidth - EDGE_GAP
  );
  const globalY = clamp(
    preferBelow ? position.y + LAUNCHER_SIZE + PANEL_GAP : position.y - panelHeight - PANEL_GAP,
    EDGE_GAP,
    viewport.height - panelHeight - EDGE_GAP
  );
  return { x: globalX - position.x, y: globalY - position.y };
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
