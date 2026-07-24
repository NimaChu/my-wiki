import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type WikiNode = {
  id: string;
  path: string;
  title: string;
  type: string;
  group?: string;
  universes?: string[];
  status: string;
  tags: string[];
  content?: string;
  out: string[];
  backlinks: string[];
};

type WikiEdge = {
  source: string;
  target: string;
  kind: string;
};

type WikiGraph = {
  generatedAt: string;
  vaultRoot: string;
  nodes: WikiNode[];
  edges: WikiEdge[];
  typedRelations: WikiEdge[];
  unresolved: Array<{ source: string; target: string }>;
  unresolvedSummary: Array<{ target: string; count: number; sources: string[] }>;
  processedIssues: Array<{ source: string; reason: string }>;
  queues: {
    inbox: string[];
    needsFollowup: string[];
    stale: string[];
  };
  stats: Record<string, number>;
};

type Filters = {
  query: string;
  groups: string[];
};

type GraphScope = "global" | "local";
type GraphMode = "knowledge" | "evidence";

type KnowledgeViewState = {
  graphScope: GraphScope;
  focusedGroup: string | null;
  selectedId: string | null;
};

type LayoutNode = WikiNode & {
  x: number;
  y: number;
  z?: number;
  depthScale?: number;
  depthOpacity?: number;
  universeRadius?: number;
  universeCenterX?: number;
  universeCenterY?: number;
  degree: number;
};

type GroupLabel = {
  group: string;
  label: string;
  x: number;
  y: number;
  count: number;
  color: string;
  radius: number;
};

const viewBox = { width: 1280, height: 760 };
const initialRotation = { x: -0.28, y: 0.36 };

const groupPalette = [
  "#68a6a1",
  "#d29a54",
  "#8da2ff",
  "#77b56b",
  "#d87c70",
  "#c486d7",
  "#d5c266",
  "#82b8df",
  "#aeb7bd",
  "#d08b6a",
  "#8cbf7a",
  "#7ab5c5"
];

const initialFilters: Filters = {
  query: "",
  groups: []
};

type Language = "en" | "zh";
type CopyVariables = Record<string, string | number>;

const copy = {
  en: {
    graphUnavailable: "Graph unavailable",
    loadingGraph: "Loading graph",
    localWorkspace: "Local knowledge workspace",
    searchAndFilter: "Search and filter My Wiki pages",
    search: "Search",
    searchPlaceholder: "Search wiki pages, tags, paths",
    clearSearch: "Clear search",
    universe: "Universe",
    allUniverses: "All universes",
    universeCount: "{count} universes",
    back: "Back",
    evidenceTitle: "Evidence: {title}",
    neighbors: "Neighbors",
    degree: "Degree",
    high: "High",
    graphAria: "My Wiki knowledge graph",
    resizePanel: "Resize information panel",
    language: "Language",
    switchChinese: "Switch to Chinese",
    switchEnglish: "Switch to English",
    selectNode: "Select a node",
    evidence: "Evidence ({count})",
    backToKnowledge: "Back to Knowledge",
    status: "Status",
    type: "Type",
    links: "Links",
    backlinks: "Backlinks",
    noWikiText: "No wiki text available",
    attention: "Attention",
    brokenPrefix: "Broken",
    gatePrefix: "Gate",
    evidenceLinks: "Evidence Links",
    connectedPages: "Connected Pages",
    noConnectedPages: "No connected pages",
    wikiEvidenceSummary: "{wiki} wiki pages, {raw} raw evidence notes",
    visible: "Visible",
    wiki: "Wiki",
    raw: "Raw",
    tags: "Tags",
    statuses: "Statuses",
    pending: "Pending",
    inbox: "Inbox",
    processed: "Processed",
    broken: "Broken",
    centralWikiPages: "Central Wiki Pages",
    linkStatus: "{count} links / {status}",
    vaultOverview: "Vault Overview",
    graphHealth: "Global graph health and maintenance state",
    maintenanceQueue: "Maintenance Queue",
    noPendingRaw: "No pending raw items"
  },
  zh: {
    graphUnavailable: "知识图谱不可用",
    loadingGraph: "正在加载知识图谱",
    localWorkspace: "本地知识工作区",
    searchAndFilter: "搜索和筛选 My Wiki 页面",
    search: "搜索",
    searchPlaceholder: "搜索 Wiki 页面、标签或路径",
    clearSearch: "清空搜索",
    universe: "知识宇宙",
    allUniverses: "全部宇宙",
    universeCount: "{count} 个宇宙",
    back: "返回",
    evidenceTitle: "证据：{title}",
    neighbors: "关联节点",
    degree: "连接度",
    high: "高",
    graphAria: "My Wiki 知识图谱",
    resizePanel: "调整信息面板宽度",
    language: "语言",
    switchChinese: "切换为中文",
    switchEnglish: "切换为英文",
    selectNode: "请选择一个节点",
    evidence: "查看证据（{count}）",
    backToKnowledge: "返回知识层",
    status: "状态",
    type: "类型",
    links: "链接",
    backlinks: "反向链接",
    noWikiText: "暂无 Wiki 正文",
    attention: "需要注意",
    brokenPrefix: "断裂链接",
    gatePrefix: "处理门槛",
    evidenceLinks: "证据链接",
    connectedPages: "关联页面",
    noConnectedPages: "暂无关联页面",
    wikiEvidenceSummary: "{wiki} 个 Wiki 页面，{raw} 条原始证据",
    visible: "当前显示",
    wiki: "Wiki",
    raw: "原始资料",
    tags: "标签",
    statuses: "状态类型",
    pending: "待处理",
    inbox: "收件箱",
    processed: "已处理",
    broken: "断裂链接",
    centralWikiPages: "核心 Wiki 页面",
    linkStatus: "{count} 条链接 / {status}",
    vaultOverview: "知识库概览",
    graphHealth: "全局图谱健康与维护状态",
    maintenanceQueue: "维护队列",
    noPendingRaw: "没有待处理的原始资料"
  }
} as const;

type CopyKey = keyof typeof copy.en;
type Translator = (key: CopyKey, variables?: CopyVariables) => string;

const I18nContext = React.createContext<{ language: Language; t: Translator }>({
  language: "en",
  t: (key) => copy.en[key]
});

function detectInitialLanguage(): Language {
  try {
    const saved = window.localStorage.getItem("my-wiki-language");
    if (saved === "en" || saved === "zh") return saved;
  } catch {
    // Browser storage can be unavailable in hardened local profiles.
  }
  const systemLanguage = window.navigator.languages?.[0] ?? window.navigator.language ?? "en";
  return systemLanguage.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function translatorFor(language: Language): Translator {
  return (key, variables = {}) => Object.entries(variables).reduce(
    (text, [name, value]) => text.split(`{${name}}`).join(String(value)),
    copy[language][key] as string
  );
}

function useI18n() {
  return React.useContext(I18nContext);
}

function localizedStatus(value: string, language: Language) {
  if (language === "en") return value;
  const statuses: Record<string, string> = {
    active: "有效",
    inbox: "待处理",
    processed: "已处理",
    "needs-followup": "待跟进",
    stale: "已过期",
    unknown: "未知"
  };
  return statuses[value.toLowerCase()] ?? value;
}

function localizedType(value: string, language: Language) {
  if (language === "en") return value;
  const types: Record<string, string> = {
    concept: "概念",
    topic: "主题",
    method: "方法",
    product: "产品",
    company: "组织",
    person: "人物",
    comparison: "对比",
    "raw-source": "原始资料"
  };
  return types[value.toLowerCase()] ?? value;
}

function App() {
  const [language, setLanguage] = useState<Language>(detectInitialLanguage);
  const [graph, setGraph] = useState<WikiGraph | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [graphMode, setGraphMode] = useState<GraphMode>("knowledge");
  const [evidenceWikiId, setEvidenceWikiId] = useState<string | null>(null);
  const [evidenceReturnView, setEvidenceReturnView] = useState<KnowledgeViewState | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [graphScope, setGraphScope] = useState<GraphScope>("global");
  const [focusedGroup, setFocusedGroup] = useState<string | null>(null);
  const [localDepth, setLocalDepth] = useState(1);
  const [showLabels, setShowLabels] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(initialRotation);
  const [rightPanelWidth, setRightPanelWidth] = useState(560);
  const [isResizingPanel, setIsResizingPanel] = useState(false);
  const hasLoadedGraph = useRef(false);
  const t = useMemo(() => translatorFor(language), [language]);
  const i18n = useMemo(() => ({ language, t }), [language, t]);

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    try {
      window.localStorage.setItem("my-wiki-language", language);
    } catch {
      // Language selection still works for the active session.
    }
  }, [language]);

  useEffect(() => {
    let cancelled = false;
    const loadGraph = (resetSelection = false) => {
      fetch(`/wiki-graph.json?t=${Date.now()}`, { cache: "no-store" })
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json();
        })
        .then((data: WikiGraph) => {
          if (cancelled) return;
          setGraph((current) => current?.generatedAt === data.generatedAt && current.nodes.length === data.nodes.length ? current : data);
          hasLoadedGraph.current = true;
          setSelectedId((current) => {
            if (resetSelection) return null;
            if (!current) return null;
            return data.nodes.some((node) => node.id === current) ? current : null;
          });
          setLoadError(null);
        })
        .catch((error: Error) => {
          if (!cancelled && !hasLoadedGraph.current) setLoadError(error.message);
        });
    };

    loadGraph(true);
    const refreshId = window.setInterval(() => loadGraph(false), 10000);
    const refreshOnFocus = () => loadGraph(false);
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      cancelled = true;
      window.clearInterval(refreshId);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, []);

  const nodeById = useMemo(() => new Map((graph?.nodes ?? []).map((node) => [node.id, node])), [graph]);
  const filterOptions = useMemo(() => {
    const nodes = (graph?.nodes ?? []).filter((node) => node.id.startsWith("wiki/"));
    return {
      groups: unique(nodes.flatMap((node) => nodeUniverses(node)))
    };
  }, [graph]);
  const selectedGroupSet = useMemo(() => new Set(filters.groups), [filters.groups]);
  const groupPickerLabel = useMemo(() => {
    if (filters.groups.length === 0) return t("allUniverses");
    if (filters.groups.length === 1) return groupLabelText(filters.groups[0], language);
    return t("universeCount", { count: filters.groups.length });
  }, [filters.groups, language, t]);
  const wikiFilteredNodes = useMemo(() => {
    if (!graph) return [];
    const needle = filters.query.trim().toLowerCase();
    const hasSearch = needle !== "";
    return graph.nodes.filter((node) => {
      if (!node.id.startsWith("wiki/")) return false;
      if (!hasSearch) return true;
      const universes = nodeUniverses(node);
      const searchable = [node.title, node.path, node.type, node.status, ...universes, ...node.tags].join(" ").toLowerCase();
      return searchable.includes(needle) && (filters.groups.length === 0 || universes.some((universe) => filters.groups.includes(universe)));
    });
  }, [graph, filters]);

  const evidenceCenterId = useMemo(() => {
    if (graphMode !== "evidence") return null;
    if (evidenceWikiId && nodeById.get(evidenceWikiId)?.id.startsWith("wiki/")) return evidenceWikiId;
    if (selectedId && nodeById.get(selectedId)?.id.startsWith("wiki/")) return selectedId;
    return pickLocalCenter(wikiFilteredNodes)?.id ?? null;
  }, [evidenceWikiId, graphMode, nodeById, selectedId, wikiFilteredNodes]);

  const evidenceNodeIds = useMemo(() => {
    if (!graph || !evidenceCenterId) return new Set<string>();
    return evidenceIdsForWiki(graph, evidenceCenterId);
  }, [evidenceCenterId, graph]);

  const baseFilteredNodes = useMemo(() => {
    if (!graph) return [];
    if (graphMode === "evidence") return graph.nodes.filter((node) => evidenceNodeIds.has(node.id));
    if (focusedGroup && graphScope === "global") return wikiFilteredNodes.filter((node) => nodeUniverses(node).includes(focusedGroup));
    return wikiFilteredNodes;
  }, [evidenceNodeIds, focusedGroup, graph, graphMode, graphScope, wikiFilteredNodes]);

  const activeSelectedId = useMemo(() => {
    if (graphMode === "evidence") {
      if (selectedId && baseFilteredNodes.some((node) => node.id === selectedId)) return selectedId;
      return evidenceCenterId;
    }
    if (selectedId && !baseFilteredNodes.some((node) => node.id === selectedId)) return null;
    if (graphScope !== "local") return selectedId;
    if (selectedId && baseFilteredNodes.some((node) => node.id === selectedId)) return selectedId;
    return pickLocalCenter(baseFilteredNodes)?.id ?? null;
  }, [baseFilteredNodes, evidenceCenterId, graphMode, graphScope, selectedId]);

  const layoutScope = graphMode === "evidence" ? "local" : graphScope;
  const layoutCenterId = graphMode === "evidence" ? evidenceCenterId : activeSelectedId;
  const filteredNodes = useMemo(
    () => graphMode === "evidence" ? baseFilteredNodes : applyGraphScope(baseFilteredNodes, graph, activeSelectedId, graphScope, localDepth),
    [baseFilteredNodes, graph, activeSelectedId, graphMode, graphScope, localDepth]
  );
  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map((node) => node.id)), [filteredNodes]);
  const filteredEdges = useMemo(() => {
    if (!graph) return [];
    return graph.edges.filter((edge) => filteredNodeIds.has(edge.source) && filteredNodeIds.has(edge.target));
  }, [graph, filteredNodeIds]);
  const displayEdges = useMemo(() => {
    if (graphMode === "knowledge" && graphScope === "global" && !focusedGroup) {
      return buildOverviewEdges(filteredNodes, filteredEdges);
    }
    return filteredEdges;
  }, [filteredEdges, filteredNodes, focusedGroup, graphMode, graphScope]);

  const canRotateLayout = graphMode === "knowledge" && graphScope === "global" && Boolean(focusedGroup);
  const layoutRotation = canRotateLayout ? rotation : initialRotation;
  const layout = useMemo(() => buildLayout(filteredNodes, displayEdges, layoutScope, layoutCenterId, layoutRotation), [filteredNodes, displayEdges, layoutScope, layoutCenterId, layoutRotation]);
  const layoutById = useMemo(() => new Map(layout.map((node) => [node.id, node])), [layout]);
  const selected = activeSelectedId ? nodeById.get(activeSelectedId) ?? null : null;
  const evidenceCenter = evidenceCenterId ? nodeById.get(evidenceCenterId) ?? null : null;
  const panelNode = graphMode === "evidence" ? evidenceCenter : selected;
  const evidenceButtonId = useMemo(() => {
    if (activeSelectedId && nodeById.get(activeSelectedId)?.id.startsWith("wiki/")) return activeSelectedId;
    if (selectedId && nodeById.get(selectedId)?.id.startsWith("wiki/")) return selectedId;
    return pickLocalCenter(wikiFilteredNodes)?.id ?? null;
  }, [activeSelectedId, nodeById, selectedId, wikiFilteredNodes]);
  const highlighted = useMemo(() => {
    if (!activeSelectedId || !graph) return new Set<string>();
    const ids = new Set([activeSelectedId]);
    for (const edge of displayEdges) {
      if (edge.source === activeSelectedId) ids.add(edge.target);
      if (edge.target === activeSelectedId) ids.add(edge.source);
    }
    return ids;
  }, [graph, displayEdges, activeSelectedId]);

  const openEvidence = (id: string) => {
    const node = nodeById.get(id);
    if (!node?.id.startsWith("wiki/")) return;
    setEvidenceReturnView({
      graphScope,
      focusedGroup,
      selectedId: focusedGroup || graphScope === "global" ? null : selectedId
    });
    setGraphMode("evidence");
    setEvidenceWikiId(node.id);
    setSelectedId(node.id);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotation(initialRotation);
  };

  const backToKnowledge = () => {
    const returnView = evidenceReturnView;
    setGraphMode("knowledge");
    setEvidenceWikiId(null);
    setEvidenceReturnView(null);
    setGraphScope(returnView?.graphScope ?? "global");
    setFocusedGroup(returnView?.focusedGroup ?? null);
    setSelectedId(returnView?.selectedId ?? null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotation(initialRotation);
  };

  const resetGraph = () => {
    setFilters(initialFilters);
    setGraphMode("knowledge");
    setEvidenceWikiId(null);
    setEvidenceReturnView(null);
    setSelectedId(null);
    setGraphScope("global");
    setFocusedGroup(null);
    setLocalDepth(1);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotation(initialRotation);
  };

  const toggleGroupFilter = (group: string) => {
    setFilters((current) => {
      const groups = current.groups.includes(group)
        ? current.groups.filter((item) => item !== group)
        : [...current.groups, group];
      return { ...current, groups };
    });
  };

  const zoomByWheel = (deltaY: number) => {
    const direction = deltaY > 0 ? 0.92 : 1.08;
    setZoom((value) => clamp(value * direction, 0.55, 2.4));
  };

  const panByDrag = (dx: number, dy: number) => {
    setPan((value) => ({ x: value.x + dx, y: value.y + dy }));
  };

  const rotateByDrag = (dx: number, dy: number) => {
    setRotation((value) => ({
      x: clamp(value.x + dy * 0.008, -1.35, 1.35),
      y: value.y + dx * 0.008
    }));
  };

  const openGroup = (group: string) => {
    setGraphMode("knowledge");
    setEvidenceReturnView(null);
    setGraphScope("global");
    setFocusedGroup(group);
    setSelectedId(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotation(initialRotation);
  };

  const closeGroup = () => {
    setEvidenceReturnView(null);
    setFocusedGroup(null);
    setSelectedId(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotation(initialRotation);
  };

  const isUniverseOverview = graphMode === "knowledge" && graphScope === "global" && !focusedGroup;
  const canNavigateBack = graphMode === "evidence" || Boolean(focusedGroup) || graphScope === "local";
  const layerTitle = graphMode === "evidence" && evidenceCenter
    ? t("evidenceTitle", { title: evidenceCenter.title })
    : focusedGroup
      ? groupLabelText(focusedGroup, language)
      : graphScope === "local" ? t("neighbors") : t("allUniverses");

  const navigateBack = () => {
    if (graphMode === "evidence") {
      backToKnowledge();
      return;
    }
    if (focusedGroup || graphScope === "local") {
      setGraphScope("global");
      closeGroup();
    }
  };

  const resizeRightPanel = (clientX: number) => {
    setRightPanelWidth(clamp(window.innerWidth - clientX, 420, 860));
  };

  const startPanelResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsResizingPanel(true);
    resizeRightPanel(event.clientX);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const movePanelResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isResizingPanel) return;
    resizeRightPanel(event.clientX);
  };

  const endPanelResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isResizingPanel) return;
    setIsResizingPanel(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  if (loadError) {
    return (
      <main className="empty-state">
        <h1>{t("graphUnavailable")}</h1>
        <p>{loadError}</p>
      </main>
    );
  }

  if (!graph) {
    return (
      <main className="empty-state">
        <h1>{t("loadingGraph")}</h1>
      </main>
    );
  }

  return (
    <I18nContext.Provider value={i18n}>
      <main
        className={`app-shell ${isResizingPanel ? "is-resizing-panel" : ""}`}
        style={{ "--right-panel-width": `${rightPanelWidth}px` } as React.CSSProperties}
      >
      <header className="top-nav">
        <div className="brand">
          <div className="brand-mark">M</div>
          <div>
            <h1>My Wiki</h1>
            <p>{t("localWorkspace")}</p>
          </div>
        </div>

        <section className="search-toolbar" aria-label={t("searchAndFilter")}>
          <label className="top-search">
            <span>{t("search")}</span>
            <span className="search-input-wrap">
              <input value={filters.query} onChange={(event) => setFilters({ ...filters, query: event.target.value })} placeholder={t("searchPlaceholder")} />
              {filters.query ? (
                <button className="clear-search-button" type="button" aria-label={t("clearSearch")} onClick={() => setFilters({ ...filters, query: "" })}>
                  x
                </button>
              ) : null}
            </span>
          </label>
          <div className="top-filter">
            <span>{t("universe")}</span>
            <details className="group-picker">
              <summary>{groupPickerLabel}</summary>
              <div className="group-picker-menu">
                <button type="button" className="group-picker-clear" onClick={() => setFilters({ ...filters, groups: [] })}>
                  {t("allUniverses")}
                </button>
                {filterOptions.groups.map((group) => (
                  <label key={group} className="group-picker-option">
                    <input
                      type="checkbox"
                      checked={selectedGroupSet.has(group)}
                      onChange={() => toggleGroupFilter(group)}
                    />
                    <span>{groupLabelText(group, language)}</span>
                  </label>
                ))}
              </div>
            </details>
          </div>
          <div className="language-control">
            <span>{t("language")}</span>
            <div className="language-switch" role="group" aria-label={t("language")}>
              <button
                type="button"
                className={language === "zh" ? "is-active" : ""}
                aria-pressed={language === "zh"}
                title={t("switchChinese")}
                onClick={() => setLanguage("zh")}
              >
                中
              </button>
              <button
                type="button"
                className={language === "en" ? "is-active" : ""}
                aria-pressed={language === "en"}
                title={t("switchEnglish")}
                onClick={() => setLanguage("en")}
              >
                EN
              </button>
            </div>
          </div>
        </section>

      </header>

      <section className="graph-stage">
        <div className="graph-layer-bar">
          <button className="hierarchy-button" disabled={!canNavigateBack} onClick={navigateBack}>
            {t("back")}
          </button>
          <strong>{layerTitle}</strong>
          <DegreeLegend />
        </div>
        <GraphView
          layout={layout}
          layoutById={layoutById}
          edges={displayEdges}
          selectedId={activeSelectedId}
          graphScope={layoutScope}
          graphMode={graphMode}
          focusedGroup={focusedGroup}
          hoveredId={hoveredId}
          highlighted={highlighted}
          showLabels={showLabels}
          zoom={zoom}
          pan={pan}
          onSelect={setSelectedId}
          onOpenEvidence={openEvidence}
          onOpenGroup={openGroup}
          onHover={setHoveredId}
          onWheelZoom={zoomByWheel}
          onPan={panByDrag}
          onRotate={rotateByDrag}
        />
      </section>

      <aside className="right-panel">
        <div
          className="panel-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label={t("resizePanel")}
          tabIndex={0}
          onPointerDown={startPanelResize}
          onPointerMove={movePanelResize}
          onPointerUp={endPanelResize}
          onPointerCancel={endPanelResize}
        />
        <NodeInspector
          node={panelNode}
          graph={graph}
          nodeById={nodeById}
          graphMode={graphMode}
          evidenceCenter={evidenceCenter}
          focusedGroup={focusedGroup}
          isUniverseOverview={isUniverseOverview}
          visibleNodes={filteredNodes.length}
          visibleEdges={displayEdges.length}
          onSelect={setSelectedId}
          onOpenEvidence={openEvidence}
          onBackToKnowledge={backToKnowledge}
        />
      </aside>
      </main>
    </I18nContext.Provider>
  );
}

function GraphView({
  layout,
  layoutById,
  edges,
  selectedId,
  graphScope,
  graphMode,
  focusedGroup,
  hoveredId,
  highlighted,
  showLabels,
  zoom,
  pan,
  onSelect,
  onOpenEvidence,
  onOpenGroup,
  onHover,
  onWheelZoom,
  onPan,
  onRotate
}: {
  layout: LayoutNode[];
  layoutById: Map<string, LayoutNode>;
  edges: WikiEdge[];
  selectedId: string | null;
  graphScope: GraphScope;
  graphMode: GraphMode;
  focusedGroup: string | null;
  hoveredId: string | null;
  highlighted: Set<string>;
  showLabels: boolean;
  zoom: number;
  pan: { x: number; y: number };
  onSelect: (id: string) => void;
  onOpenEvidence: (id: string) => void;
  onOpenGroup: (group: string) => void;
  onHover: (id: string | null) => void;
  onWheelZoom: (deltaY: number) => void;
  onPan: (dx: number, dy: number) => void;
  onRotate: (dx: number, dy: number) => void;
}) {
  const { language, t } = useI18n();
  const [dragMode, setDragMode] = useState<"pan" | "rotate" | null>(null);
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const draggedRef = useRef(false);
  const scale = 1 / zoom;
  const centerX = viewBox.width / 2 + pan.x;
  const centerY = viewBox.height / 2 + pan.y;
  const boxWidth = viewBox.width * scale;
  const boxHeight = viewBox.height * scale;
  const computedViewBox = `${centerX - boxWidth / 2} ${centerY - boxHeight / 2} ${boxWidth} ${boxHeight}`;
  const groupLabels = graphScope === "global" ? buildGroupLabels(layout, language) : [];
  const canEnterGroup = graphMode === "knowledge" && graphScope === "global" && !focusedGroup;
  const canRotate = graphMode === "knowledge" && graphScope === "global" && Boolean(focusedGroup);
  const displayNodes = useMemo(() => [...layout].sort((a, b) => (a.z ?? 0) - (b.z ?? 0)), [layout]);

  const startDrag = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    const target = event.target as Element;
    const startedOnNode = Boolean(target.closest(".graph-node"));
    const nextDragMode = event.button === 1 ? "pan" : canRotate && !startedOnNode ? "rotate" : null;
    if (!nextDragMode) return;
    event.preventDefault();
    setDragMode(nextDragMode);
    lastPointer.current = { x: event.clientX, y: event.clientY };
    draggedRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!dragMode || !lastPointer.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const screenDx = event.clientX - lastPointer.current.x;
    const screenDy = event.clientY - lastPointer.current.y;
    if (Math.hypot(screenDx, screenDy) > 2) draggedRef.current = true;
    if (dragMode === "pan") {
      const dx = (-screenDx * boxWidth) / Math.max(rect.width, 1);
      const dy = (-screenDy * boxHeight) / Math.max(rect.height, 1);
      onPan(dx, dy);
    } else {
      onRotate(screenDx, screenDy);
    }
    lastPointer.current = { x: event.clientX, y: event.clientY };
  };

  const endDrag = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!dragMode) return;
    const didDrag = draggedRef.current;
    setDragMode(null);
    lastPointer.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (didDrag) window.setTimeout(() => {
      draggedRef.current = false;
    }, 0);
  };

  const groupHitLayer = (
    <g className={`group-hit-layer ${canEnterGroup ? "is-enterable-layer" : ""}`}>
      {groupLabels.map((label) => {
        return (
          <g
            key={label.group}
            data-group={label.group}
            className={`group-universe ${canEnterGroup ? "is-enterable" : ""}`}
            transform={`translate(${label.x}, ${label.y})`}
            onClick={(event) => {
              if (!canEnterGroup) return;
              if (draggedRef.current) {
                draggedRef.current = false;
                return;
              }
              event.stopPropagation();
              onOpenGroup(label.group);
            }}
          >
            <circle className="universe-hit-area" r={label.radius} />
          </g>
        );
      })}
    </g>
  );

  const groupNameLayer = (
    <g className="group-name-layer">
      {groupLabels.map((label) => {
        const width = Math.min(250, Math.max(92, label.label.length * 6.2 + 28));
        const y = label.y;
        return (
          <g
            key={label.group}
            className="group-name"
            transform={`translate(${label.x}, ${y}) scale(${scale})`}
            onClick={(event) => {
              event.stopPropagation();
              onOpenGroup(label.group);
            }}
          >
            <rect x={-width / 2} y={-13} width={width} height={26} rx={13} stroke={label.color} />
            <text>{label.label}</text>
          </g>
        );
      })}
    </g>
  );

  return (
    <svg
      className={`graph-svg ${canRotate ? "can-rotate" : ""} ${canEnterGroup ? "is-universe-overview" : ""} ${focusedGroup ? "is-focused-group" : ""} ${dragMode === "pan" ? "is-panning" : ""} ${dragMode === "rotate" ? "is-rotating" : ""}`}
      viewBox={computedViewBox}
      role="img"
      aria-label={t("graphAria")}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={endDrag}
      onAuxClick={(event) => event.preventDefault()}
      onWheel={(event) => {
        event.preventDefault();
        onWheelZoom(event.deltaY);
      }}
    >
      <defs>
        <radialGradient id="nodeGlow">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.78" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        {canEnterGroup && groupLabels.map((label) => (
          <radialGradient key={label.group} id={universeGradientId(label.group)}>
            <stop offset="0%" stopColor={label.color} stopOpacity="0.16" />
            <stop offset="58%" stopColor={label.color} stopOpacity="0.085" />
            <stop offset="84%" stopColor={label.color} stopOpacity="0.035" />
            <stop offset="100%" stopColor={label.color} stopOpacity="0" />
          </radialGradient>
        ))}
      </defs>
      {canEnterGroup && (
        <g className="group-backdrop-layer" pointerEvents="none">
          {groupLabels.map((label) => (
            <circle
              key={label.group}
              className="universe-backdrop"
              cx={label.x}
              cy={label.y}
              r={label.radius}
              fill={`url(#${universeGradientId(label.group)})`}
            />
          ))}
        </g>
      )}
      {canEnterGroup && groupHitLayer}
      <g className="edge-layer">
        {edges.map((edge) => {
          const source = layoutById.get(edge.source);
          const target = layoutById.get(edge.target);
          if (!source || !target) return null;
          const isHot = selectedId ? edge.source === selectedId || edge.target === selectedId : false;
          const baseOpacity = edgeDepthOpacity(source, target);
          const crossesUniverse = primaryUniverse(source) !== primaryUniverse(target);
          const overviewOpacity = crossesUniverse
            ? clamp(0.05 + baseOpacity * 0.13, 0.07, 0.12)
            : clamp(0.075 + baseOpacity * 0.28, 0.12, 0.23);
          const strokeOpacity =
            isHot ? 1 :
            canEnterGroup && selectedId ? overviewOpacity * 0.18 :
            canEnterGroup ? overviewOpacity :
            focusedGroup && selectedId ? clamp(baseOpacity * 1.18, 0.28, 0.58) :
            focusedGroup ? clamp(baseOpacity * 0.72, 0.12, 0.26) :
            baseOpacity;
          const stroke = isHot
            ? "rgba(236, 232, 221, 0.82)"
            : canEnterGroup
              ? crossesUniverse ? "#9aa8ad" : colorForGroup(primaryUniverse(source))
              : undefined;
          if (canEnterGroup && crossesUniverse) {
            return (
              <path
                key={`${edge.source}-${edge.target}`}
                className={`graph-edge is-cross-universe ${isHot ? "is-hot" : ""}`}
                d={curvedEdgePath(source, target, 0.12)}
                fill="none"
                strokeOpacity={strokeOpacity}
                style={{ stroke }}
              />
            );
          }
          if (canEnterGroup) {
            return (
              <path
                key={`${edge.source}-${edge.target}`}
                className={`graph-edge is-within-universe ${isHot ? "is-hot" : ""}`}
                d={curvedEdgePath(source, target, 0.045)}
                fill="none"
                strokeOpacity={strokeOpacity}
                style={{ stroke }}
              />
            );
          }
          return (
            <line
              key={`${edge.source}-${edge.target}`}
              className={`graph-edge ${canEnterGroup ? "is-within-universe" : ""} ${isHot ? "is-hot" : ""}`}
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              strokeOpacity={strokeOpacity}
              style={{ stroke }}
            />
          );
        })}
      </g>
      <g className="node-layer">
        {displayNodes.map((node) => {
          const isSelected = node.id === selectedId;
          const isDim = Boolean(selectedId && highlighted.size > 0 && !highlighted.has(node.id));
          const isHovered = node.id === hoveredId;
          const shouldShowLabel = showLabels || isSelected || isHovered || (highlighted.has(node.id) && highlighted.size <= 18) || (graphMode === "evidence" && layout.length <= 24);
          const section = node.id.split("/")[0];
          const radius = canEnterGroup
            ? overviewNodeRadius(node) * nodeDepthScale(node)
            : nodeRadius(node) * nodeDepthScale(node);
          const nodeHash = stableHash(node.id);
          return (
            <g
              key={node.id}
              className={`graph-node is-${section} ${isSelected ? "is-selected" : ""} ${isDim ? "is-dim" : ""}`}
              transform={`translate(${node.x}, ${node.y})`}
              onClick={() => {
                if (draggedRef.current) {
                  draggedRef.current = false;
                  return;
                }
                onSelect(node.id);
              }}
              onDoubleClick={() => {
                if (draggedRef.current) return;
                onOpenEvidence(node.id);
              }}
              onMouseEnter={() => onHover(node.id)}
              onMouseLeave={() => onHover(null)}
              style={{
                animationDelay: `${-(nodeHash % 1100) / 100}s`,
                animationDuration: `${7 + (nodeHash % 500) / 100}s`
              }}
            >
              <title>{node.title}</title>
              <circle className="node-hit-target" r={Math.max(radius + 9, 17)} pointerEvents="all" />
              <circle className="node-halo" r={radius + 12} />
              <circle
                className="node-dot"
                r={radius}
                fill={nodeFill(node)}
                fillOpacity={nodeDepthOpacity(node)}
              />
          {shouldShowLabel && (
            <text y={radius + 18}>
              {node.title.length > 26 ? `${node.title.slice(0, 24)}...` : node.title}
            </text>
              )}
            </g>
          );
        })}
      </g>
      {canEnterGroup && groupNameLayer}
    </svg>
  );
}

function NodeInspector({
  node,
  graph,
  nodeById,
  graphMode,
  evidenceCenter,
  focusedGroup,
  isUniverseOverview,
  visibleNodes,
  visibleEdges,
  onSelect,
  onOpenEvidence,
  onBackToKnowledge
}: {
  node: WikiNode | null;
  graph: WikiGraph;
  nodeById: Map<string, WikiNode>;
  graphMode: GraphMode;
  evidenceCenter: WikiNode | null;
  focusedGroup: string | null;
  isUniverseOverview: boolean;
  visibleNodes: number;
  visibleEdges: number;
  onSelect: (id: string) => void;
  onOpenEvidence: (id: string) => void;
  onBackToKnowledge: () => void;
}) {
  const { language, t } = useI18n();
  if (!node) {
    if (isUniverseOverview) {
      return (
        <GlobalOverview
          graph={graph}
          nodeById={nodeById}
          visibleNodes={visibleNodes}
          visibleEdges={visibleEdges}
          onSelect={onSelect}
        />
      );
    }

    if (focusedGroup) {
      return (
        <UniverseOverview
          graph={graph}
          group={focusedGroup}
          visibleNodes={visibleNodes}
          visibleEdges={visibleEdges}
          onSelect={onSelect}
        />
      );
    }

    return (
      <section className="inspector">
        <p className="muted">{t("selectNode")}</p>
      </section>
    );
  }

  const neighbors = unique([...node.out, ...node.backlinks])
    .map((id) => nodeById.get(id))
    .filter(Boolean) as WikiNode[];
  const broken = graph.unresolved.filter((item) => item.source === node.id);
  const issues = graph.processedIssues.filter((item) => item.source === node.id);
  const isWikiNode = node.id.startsWith("wiki/");
  const evidenceCount = isWikiNode ? evidenceIdsForWiki(graph, node.id).size - 1 : 0;

  if (isWikiNode) {
    const articleContent = stripLeadingMarkdownTitle(node.content ?? "", node.title);
    return (
      <article className="wiki-page">
        <header className="wiki-page-header">
          <h1>{node.title}</h1>
          <p>{node.path}</p>
          <div className="wiki-actions">
            {graphMode === "knowledge" && <button onClick={() => onOpenEvidence(node.id)}>{t("evidence", { count: evidenceCount })}</button>}
            {graphMode === "evidence" && <button onClick={onBackToKnowledge}>{t("backToKnowledge")}</button>}
          </div>
        </header>

        <dl className="wiki-meta-grid">
          <div><dt>{t("status")}</dt><dd>{localizedStatus(node.status, language)}</dd></div>
          <div><dt>{t("universe")}</dt><dd>{universeListText(node, language)}</dd></div>
          <div><dt>{t("type")}</dt><dd>{localizedType(node.type, language)}</dd></div>
          <div><dt>{t("links")}</dt><dd>{node.out.length}</dd></div>
          <div><dt>{t("backlinks")}</dt><dd>{node.backlinks.length}</dd></div>
          <div><dt>{t("degree")}</dt><dd>{node.out.length + node.backlinks.length}</dd></div>
        </dl>

        <section className="tag-list">
          {node.tags.map((tag) => <span key={tag}>#{tag}</span>)}
        </section>

        {articleContent ? <MarkdownContent content={articleContent} /> : <p className="muted">{t("noWikiText")}</p>}

        {(broken.length > 0 || issues.length > 0) && (
          <section className="warning-box">
            <h3>{t("attention")}</h3>
            {broken.map((item) => <p key={item.target}>{t("brokenPrefix")}: {item.target}</p>)}
            {issues.map((item) => <p key={item.reason}>{t("gatePrefix")}: {item.reason}</p>)}
          </section>
        )}

        <section className="neighbor-list">
          <h3>{graphMode === "evidence" ? t("evidenceLinks") : t("connectedPages")}</h3>
          {neighbors.length === 0 ? (
            <p className="muted">{t("noConnectedPages")}</p>
          ) : (
            neighbors.slice(0, 18).map((neighbor) => (
              <button key={neighbor.id} onClick={() => onSelect(neighbor.id)}>
                <strong>{neighbor.title}</strong>
                <span>{primaryUniverseLabel(neighbor, language)} / {localizedStatus(neighbor.status, language)}</span>
              </button>
            ))
          )}
        </section>
      </article>
    );
  }

  return (
    <section className="inspector">
      {graphMode === "evidence" && (
        <div className="inspector-actions">
          <button onClick={onBackToKnowledge}>{t("backToKnowledge")}</button>
          {evidenceCenter && <span>{evidenceCenter.title}</span>}
        </div>
      )}
      <div className="node-title">
        <h2>{node.title}</h2>
        <p>{node.path}</p>
      </div>

      <dl className="node-metrics">
        <div><dt>{t("status")}</dt><dd>{localizedStatus(node.status, language)}</dd></div>
        <div><dt>{t("universe")}</dt><dd>{universeListText(node, language)}</dd></div>
        <div><dt>{t("type")}</dt><dd>{localizedType(node.type, language)}</dd></div>
        <div><dt>{t("links")}</dt><dd>{node.out.length}</dd></div>
        <div><dt>{t("backlinks")}</dt><dd>{node.backlinks.length}</dd></div>
        <div><dt>{t("degree")}</dt><dd>{node.out.length + node.backlinks.length}</dd></div>
      </dl>

      <section className="tag-list">
        {node.tags.map((tag) => <span key={tag}>#{tag}</span>)}
      </section>

      {(broken.length > 0 || issues.length > 0) && (
        <section className="warning-box">
          <h3>{t("attention")}</h3>
          {broken.map((item) => <p key={item.target}>{t("brokenPrefix")}: {item.target}</p>)}
          {issues.map((item) => <p key={item.reason}>{t("gatePrefix")}: {item.reason}</p>)}
        </section>
      )}

      <section className="neighbor-list">
        <h3>{graphMode === "evidence" ? t("evidenceLinks") : t("connectedPages")}</h3>
        {neighbors.length === 0 ? (
          <p className="muted">{t("noConnectedPages")}</p>
        ) : (
            neighbors.slice(0, 18).map((neighbor) => (
              <button key={neighbor.id} onClick={() => onSelect(neighbor.id)}>
                <strong>{neighbor.title}</strong>
                <span>{primaryUniverseLabel(neighbor, language)} / {localizedStatus(neighbor.status, language)}</span>
              </button>
            ))
        )}
      </section>
    </section>
  );
}

function UniverseOverview({
  graph,
  group,
  visibleNodes,
  visibleEdges,
  onSelect
}: {
  graph: WikiGraph;
  group: string;
  visibleNodes: number;
  visibleEdges: number;
  onSelect: (id: string) => void;
}) {
  const { language, t } = useI18n();
  const summary = useMemo(() => buildUniverseSummary(graph, group), [graph, group]);
  return (
    <section className="group-overview">
      <header>
        <span className="panel-kicker">{t("universe")}</span>
        <h2>{groupLabelText(group, language)}</h2>
        <p>{t("wikiEvidenceSummary", { wiki: summary.wikiNodes.length, raw: summary.evidenceCount })}</p>
      </header>

      <Stats
        graph={graph}
        visibleNodes={visibleNodes}
        visibleEdges={visibleEdges}
        items={[
          [t("visible"), visibleNodes],
          [t("links"), visibleEdges],
          [t("wiki"), summary.wikiNodes.length],
          [t("raw"), summary.evidenceCount],
          [t("tags"), summary.topTags.length],
          [t("statuses"), summary.statuses.length]
        ]}
      />

      {summary.topTags.length > 0 && (
        <section className="tag-list">
          {summary.topTags.map(([tag, count]) => <span key={tag}>#{tag} {count}</span>)}
        </section>
      )}

      <section className="neighbor-list">
        <h3>{t("centralWikiPages")}</h3>
        {summary.topPages.map((node) => (
          <button key={node.id} onClick={() => onSelect(node.id)}>
            <strong>{node.title}</strong>
            <span>{t("linkStatus", { count: node.out.length + node.backlinks.length, status: localizedStatus(node.status, language) })}</span>
          </button>
        ))}
      </section>
    </section>
  );
}

function GlobalOverview({
  graph,
  nodeById,
  visibleNodes,
  visibleEdges,
  onSelect
}: {
  graph: WikiGraph;
  nodeById: Map<string, WikiNode>;
  visibleNodes: number;
  visibleEdges: number;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <section className="global-overview">
      <header>
        <h2>{t("vaultOverview")}</h2>
        <p>{t("graphHealth")}</p>
      </header>
      <Stats graph={graph} visibleNodes={visibleNodes} visibleEdges={visibleEdges} />
      <QueueSummary graph={graph} nodeById={nodeById} onSelect={onSelect} />
    </section>
  );
}

function MarkdownContent({ content }: { content: string }) {
  const blocks = useMemo(() => markdownBlocks(content), [content]);
  return <section className="wiki-markdown">{blocks}</section>;
}

function markdownBlocks(content: string) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let code: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join(" ");
    blocks.push(<p key={`p-${blocks.length}`}>{renderInlineMarkdown(text, `p-${blocks.length}`)}</p>);
    paragraph = [];
  };
  const flushList = () => {
    if (list.length === 0) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`}>
        {list.map((item, index) => <li key={`${item}-${index}`}>{renderInlineMarkdown(item, `li-${blocks.length}-${index}`)}</li>)}
      </ul>
    );
    list = [];
  };
  const flushCode = () => {
    if (!code) return;
    blocks.push(<pre key={`code-${blocks.length}`}><code>{code.join("\n")}</code></pre>);
    code = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.startsWith("```")) {
      if (code) flushCode();
      else {
        flushParagraph();
        flushList();
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      const text = heading[2];
      if (level === 1) blocks.push(<h2 key={`h-${blocks.length}`}>{renderInlineMarkdown(text, `h-${blocks.length}`)}</h2>);
      else if (level === 2) blocks.push(<h3 key={`h-${blocks.length}`}>{renderInlineMarkdown(text, `h-${blocks.length}`)}</h3>);
      else blocks.push(<h4 key={`h-${blocks.length}`}>{renderInlineMarkdown(text, `h-${blocks.length}`)}</h4>);
      continue;
    }

    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();
  flushCode();
  return blocks;
}

function renderInlineMarkdown(text: string, keyPrefix: string) {
  const nodes: React.ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[\[[^\]]+\]\]|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));

    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;
    if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{renderInlineMarkdown(token.slice(2, -2), `${key}-strong`)}</strong>);
    } else if (token.startsWith("[[")) {
      const body = token.slice(2, -2);
      const [target, label] = body.split("|");
      nodes.push(<span className="wiki-link-chip" key={key}>{(label ?? target).trim()}</span>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link) {
        nodes.push(<a key={key} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>);
      } else {
        nodes.push(token);
      }
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function stripLeadingMarkdownTitle(content: string, title: string) {
  const normalizedTitle = title.trim().toLowerCase();
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.replace(/^#\s+/, "").trim().toLowerCase() === normalizedTitle) {
    return lines.slice(1).join("\n").trim();
  }
  return content.trim();
}

function Stats({ graph, visibleNodes, visibleEdges, items }: { graph: WikiGraph; visibleNodes: number; visibleEdges: number; items?: Array<[string, number]> }) {
  const { t } = useI18n();
  const defaultItems: Array<[string, number]> = [
    [t("visible"), visibleNodes],
    [t("links"), visibleEdges],
    [t("wiki"), graph.stats.wikiPages ?? 0],
    [t("raw"), graph.stats.rawSources ?? 0],
    [t("pending"), graph.stats.pendingRaw ?? 0],
    [t("inbox"), graph.stats.inbox ?? 0],
    [t("processed"), graph.stats.processed ?? 0],
    [t("broken"), graph.stats.unresolved ?? 0]
  ];
  const displayItems = items ?? defaultItems;

  return (
    <section className="stats-grid">
      {displayItems.map(([label, value]) => (
        <div key={label} className="stat-card">
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </section>
  );
}

function QueueSummary({ graph, nodeById, onSelect }: { graph: WikiGraph; nodeById: Map<string, WikiNode>; onSelect: (id: string) => void }) {
  const { language, t } = useI18n();
  const ids = [...graph.queues.inbox, ...graph.queues.needsFollowup, ...graph.queues.stale].slice(0, 8);
  const nodes = ids.map((id) => nodeById.get(id)).filter(Boolean) as WikiNode[];
  return (
    <section className="queue-panel">
      <h2>{t("maintenanceQueue")}</h2>
      {nodes.length === 0 ? (
        <p className="muted">{t("noPendingRaw")}</p>
      ) : (
        nodes.map((node) => (
          <button key={node.id} onClick={() => onSelect(node.id)}>
            <strong>{node.title}</strong>
            <span>{localizedStatus(node.status, language)}</span>
          </button>
        ))
      )}
    </section>
  );
}

function buildUniverseSummary(graph: WikiGraph, group: string) {
  const wikiNodes = graph.nodes.filter((node) => node.id.startsWith("wiki/") && nodeUniverses(node).includes(group));
  const wikiIds = new Set(wikiNodes.map((node) => node.id));
  const evidenceIds = new Set<string>();
  const statusCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();

  for (const node of wikiNodes) {
    statusCounts.set(node.status, (statusCounts.get(node.status) ?? 0) + 1);
    for (const tag of node.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }

  for (const edge of graph.edges) {
    if (wikiIds.has(edge.source) && edge.target.startsWith("raw/")) evidenceIds.add(edge.target);
    if (wikiIds.has(edge.target) && edge.source.startsWith("raw/")) evidenceIds.add(edge.source);
  }

  const topPages = [...wikiNodes]
    .sort((a, b) => (b.out.length + b.backlinks.length) - (a.out.length + a.backlinks.length))
    .slice(0, 10);
  const topTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12);
  const statuses = [...statusCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  return {
    wikiNodes,
    evidenceCount: evidenceIds.size,
    topPages,
    topTags,
    statuses
  };
}

type SimNode = LayoutNode & {
  vx: number;
  vy: number;
};

function buildLayout(
  nodes: WikiNode[],
  edges: WikiEdge[],
  scope: GraphScope,
  selectedId: string | null,
  rotation: { x: number; y: number }
): LayoutNode[] {
  const width = viewBox.width;
  const height = viewBox.height;
  const isLocal = scope === "local";
  const degree = new Map(nodes.map((node) => [node.id, node.out.length + node.backlinks.length]));
  if (!isLocal && nodes.every((node) => node.id.startsWith("wiki/"))) return buildWikiUniverseLayout(nodes, degree, rotation);
  if (!isLocal && nodes.length > 450) return buildLargeGraphLayout(nodes, degree);
  const groups = unique(nodes.map((node) => primaryUniverse(node)));
  const groupIndex = new Map(groups.map((group, index) => [group, index]));
  const localGroupIndex = new Map<string, number>();
  const points: SimNode[] = nodes.map((node, index) => {
    const angle = index * 2.399963229728653;
    const section = node.id.split("/")[0];
    const group = primaryUniverse(node);
    const localIndex = localGroupIndex.get(group) ?? 0;
    localGroupIndex.set(group, localIndex + 1);
    const radius =
      isLocal ? 52 + Math.sqrt(index + 1) * 28 :
      section === "wiki" ? 58 + Math.sqrt(localIndex + 1) * 16 :
      section === "raw" ? 22 + Math.sqrt(localIndex + 1) * 8 :
      48 + Math.sqrt(localIndex + 1) * 10;
    const target = isLocal ? localTarget(node, index, selectedId) : clusterTarget(node, groupIndex, groups.length);
    return {
      ...node,
      degree: degree.get(node.id) ?? 0,
      x: target.x + Math.cos(angle) * radius,
      y: target.y + Math.sin(angle) * radius,
      vx: 0,
      vy: 0
    };
  });
  const byId = new Map(points.map((node) => [node.id, node]));
  const layoutEdges = edges.map((edge) => [byId.get(edge.source), byId.get(edge.target)] as const).filter(([a, b]) => a && b);
  const ticks = isLocal ? 240 : points.length > 900 ? 180 : 260;

  for (let tick = 0; tick < ticks; tick += 1) {
    const alpha = 1 - tick / ticks;
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const a = points[i];
        const b = points[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const sameGroup = primaryUniverse(a) === primaryUniverse(b);
        const dist2 = Math.max(dx * dx + dy * dy, isLocal ? 90 : sameGroup ? 42 : 120);
        const force = ((isLocal ? 430 : sameGroup ? 150 : 360) * alpha) / dist2;
        const fx = dx * force;
        const fy = dy * force;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
    }

    for (const [a, b] of layoutEdges) {
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const target =
        isLocal ? 118 :
        a.id.startsWith("wiki/") && b.id.startsWith("wiki/") ? 92 :
        a.id.startsWith("raw/") && b.id.startsWith("raw/") ? 82 :
        178;
      const force = (distance - target) * (isLocal ? 0.018 : 0.008) * alpha;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    for (const node of points) {
      const target = isLocal ? localTarget(node, 0, selectedId) : clusterTarget(node, groupIndex, groups.length);
      const centerPull =
        isLocal && node.id === selectedId ? 0.09 :
        isLocal ? 0.018 :
        node.id.startsWith("wiki/") ? 0.028 :
        node.id.startsWith("raw/") ? 0.038 :
        0.02;
      node.vx += (target.x - node.x) * centerPull * alpha;
      node.vy += (target.y - node.y) * centerPull * alpha;
      if (node.x < 70) node.vx += (70 - node.x) * 0.04;
      if (node.x > width - 70) node.vx -= (node.x - (width - 70)) * 0.04;
      if (node.y < 70) node.vy += (70 - node.y) * 0.04;
      if (node.y > height - 70) node.vy -= (node.y - (height - 70)) * 0.04;
      node.x += node.vx;
      node.y += node.vy;
      node.vx *= 0.76;
      node.vy *= 0.76;
    }
  }

  return points.map(({ vx: _vx, vy: _vy, ...node }) => ({
    ...node,
    x: clamp(node.x, 58, width - 58),
    y: clamp(node.y, 58, height - 58)
  }));
}

function buildWikiUniverseLayout(nodes: WikiNode[], degree: Map<string, number>, rotation: { x: number; y: number }): LayoutNode[] {
  const groupBuckets = new Map<string, WikiNode[]>();
  for (const node of nodes) {
    const group = primaryUniverse(node);
    groupBuckets.set(group, [...(groupBuckets.get(group) ?? []), node]);
  }

  const groups = Array.from(groupBuckets.keys())
    .sort((a, b) => (groupBuckets.get(b)?.length ?? 0) - (groupBuckets.get(a)?.length ?? 0) || a.localeCompare(b));
  const sharedUniversePairs = sharedWikiUniversePairs(nodes);
  const isOverview = groups.length > 1;
  const overviewRadius = overviewUniverseRadius(groups.length);
  const overviewRadii = new Map(groups.map((group) => [group, overviewRadius]));
  const centers = wikiSphereCenters(groups, overviewRadii, sharedUniversePairs);

  if (isOverview) {
    return groups.flatMap((group) => {
      const bucket = [...(groupBuckets.get(group) ?? [])]
        .sort((a, b) => nodeDegree(b) - nodeDegree(a) || a.title.localeCompare(b.title));
      const center = centers.get(group) ?? { x: viewBox.width / 2, y: viewBox.height / 2 };
      const sphereRadius = overviewRadii.get(group) ?? overviewRadius;

      return bucket.map((node, index) => {
        const point = neuralClusterPoint(index, bucket.length, node.id);
        const membershipCenters = nodeUniverses(node)
          .map((universe) => centers.get(universe))
          .filter((candidate): candidate is { x: number; y: number } => Boolean(candidate));
        const anchor = membershipCenters.length > 1
          ? {
              x: membershipCenters.reduce((sum, candidate) => sum + candidate.x, 0) / membershipCenters.length,
              y: membershipCenters.reduce((sum, candidate) => sum + candidate.y, 0) / membershipCenters.length
            }
          : center;
        return {
          ...node,
          degree: degree.get(node.id) ?? 0,
          x: anchor.x + point.x * sphereRadius,
          y: anchor.y + point.y * sphereRadius,
          z: point.z,
          depthScale: 0.86 + point.z * 0.14,
          depthOpacity: 0.76 + point.z * 0.24,
          universeRadius: sphereRadius,
          universeCenterX: center.x,
          universeCenterY: center.y
        };
      });
    });
  }

  return groups.flatMap((group) => {
    const bucket = [...(groupBuckets.get(group) ?? [])]
      .sort((a, b) => nodeDegree(b) - nodeDegree(a) || a.title.localeCompare(b.title));
    const center = centers.get(group) ?? { x: viewBox.width / 2, y: viewBox.height / 2 };
    const sphereRadius = isOverview ? overviewRadii.get(group) ?? overviewUniverseRadius(groups.length) : groupSphereRadius(bucket.length);
    const count = bucket.length;

    return bucket.map((node, index) => {
      const point = rotateSpherePoint(fibonacciSpherePoint(index, count), rotation);
      const depthShear = 0.06;
      const x = center.x + (point.x + point.z * depthShear) * sphereRadius;
      const y = center.y + (point.y - point.z * depthShear) * sphereRadius;
      const depth = (point.z + 1) / 2;
      return {
        ...node,
        degree: degree.get(node.id) ?? 0,
        x: clamp(x, 42, viewBox.width - 42),
        y: clamp(y, 42, viewBox.height - 42),
        z: point.z,
        depthScale: 0.66 + depth * 0.34,
        depthOpacity: 0.52 + depth * 0.48,
        universeRadius: undefined,
        universeCenterX: undefined,
        universeCenterY: undefined
      };
    });
  });
}

function neuralClusterPoint(index: number, count: number, id: string) {
  if (count <= 1) return { x: 0, y: 0, z: 0.72 };
  const hash = stableHash(id);
  const progress = (index + 0.42) / count;
  const angleJitter = ((hash % 1009) / 1009 - 0.5) * 0.48;
  const angle = index * 2.399963229728653 + angleJitter;
  const radialNoise = 0.88 + ((hash >>> 8) % 1000) / 5200;
  const radius = Math.pow(progress, 0.62) * radialNoise;
  const z = 0.38 + ((hash >>> 16) % 1000) / 1620;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius * (0.91 + ((hash >>> 4) % 17) / 170),
    z: clamp(z, 0.38, 1)
  };
}

function curvedEdgePath(source: LayoutNode, target: LayoutNode, bendRatio: number) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.max(Math.hypot(dx, dy), 1);
  const direction = stableHash(`${source.id}|${target.id}`) % 2 === 0 ? 1 : -1;
  const bend = Math.min(52, distance * bendRatio) * direction;
  const controlX = (source.x + target.x) / 2 - (dy / distance) * bend;
  const controlY = (source.y + target.y) / 2 + (dx / distance) * bend;
  return `M ${source.x} ${source.y} Q ${controlX} ${controlY} ${target.x} ${target.y}`;
}

function rotateSpherePoint(point: { x: number; y: number; z: number }, rotation: { x: number; y: number }) {
  const cosX = Math.cos(rotation.x);
  const sinX = Math.sin(rotation.x);
  const cosY = Math.cos(rotation.y);
  const sinY = Math.sin(rotation.y);
  const y1 = point.y * cosX - point.z * sinX;
  const z1 = point.y * sinX + point.z * cosX;
  return {
    x: point.x * cosY + z1 * sinY,
    y: y1,
    z: -point.x * sinY + z1 * cosY
  };
}

function wikiSphereCenters(groups: string[], universeRadii: Map<string, number>, sharedUniversePairs: Set<string>) {
  const centers = new Map<string, { x: number; y: number }>();
  if (groups.length === 0) return centers;
  if (groups.length === 1) {
    centers.set(groups[0], { x: viewBox.width / 2, y: viewBox.height / 2 });
    return centers;
  }

  const maxRadius = Math.max(...groups.map((group) => universeRadii.get(group) ?? overviewUniverseRadius(groups.length)));
  const gap = Math.max(48, maxRadius * 0.3);
  const cols = groups.length === 4 ? 2 : Math.min(groups.length, Math.max(2, Math.ceil(Math.sqrt(groups.length * 1.45))));
  const rows = Math.ceil(groups.length / cols);
  const stepX = maxRadius * 2 + gap;
  const stepY = maxRadius * 2 + gap;
  const startX = viewBox.width / 2 - ((cols - 1) * stepX) / 2;
  const startY = viewBox.height / 2 - ((rows - 1) * stepY) / 2;
  groups.forEach((group, index) => {
    const row = Math.floor(index / cols);
    const col = index % cols;
    const rowCount = Math.min(cols, groups.length - row * cols);
    const rowOffset = ((cols - rowCount) * stepX) / 2;
    centers.set(group, {
      x: startX + col * stepX + rowOffset,
      y: startY + row * stepY
    });
  });
  return settleUniverseCenters(groups, centers, universeRadii, sharedUniversePairs);
}

function settleUniverseCenters(groups: string[], initialCenters: Map<string, { x: number; y: number }>, universeRadii: Map<string, number>, sharedUniversePairs: Set<string>) {
  const centers = new Map(groups.map((group) => {
    const center = initialCenters.get(group) ?? { x: viewBox.width / 2, y: viewBox.height / 2 };
    return [group, { ...center, vx: 0, vy: 0 }];
  }));
  const attractionCenter = { x: viewBox.width / 2, y: viewBox.height / 2 };

  for (let tick = 0; tick < 180; tick += 1) {
    const alpha = 1 - tick / 180;
    for (const group of groups) {
      const center = centers.get(group);
      if (!center) continue;
      center.vx += (attractionCenter.x - center.x) * 0.0026 * alpha;
      center.vy += (attractionCenter.y - center.y) * 0.0026 * alpha;
    }

    for (let i = 0; i < groups.length; i += 1) {
      for (let j = i + 1; j < groups.length; j += 1) {
        const a = centers.get(groups[i]);
        const b = centers.get(groups[j]);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.max(Math.hypot(dx, dy), 0.001);
        const shared = sharedUniversePairs.has(universePairKey(groups[i], groups[j]));
        const aRadius = universeRadii.get(groups[i]) ?? overviewUniverseRadius(groups.length);
        const bRadius = universeRadii.get(groups[j]) ?? overviewUniverseRadius(groups.length);
        const noOverlapDistance = aRadius + bRadius + Math.max(34, Math.min(aRadius, bRadius) * 0.2);
        const sharedOverlapDistance = (aRadius + bRadius) * 0.68;
        const targetDistance = shared ? sharedOverlapDistance : noOverlapDistance;

        if (distance < targetDistance) {
          const push = ((targetDistance - distance) / distance) * 0.5;
          const px = dx * push;
          const py = dy * push;
          a.vx -= px;
          a.vy -= py;
          b.vx += px;
          b.vy += py;
        } else {
          const pull = (distance - targetDistance) * (shared ? 0.0018 : 0.00055) * alpha;
          const px = (dx / distance) * pull;
          const py = (dy / distance) * pull;
          a.vx += px;
          a.vy += py;
          b.vx -= px;
          b.vy -= py;
        }
      }
    }

    for (const center of centers.values()) {
      center.x += center.vx;
      center.y += center.vy;
      center.vx *= 0.72;
      center.vy *= 0.72;
    }
  }

  return new Map(groups.map((group) => {
    const center = centers.get(group) ?? { x: viewBox.width / 2, y: viewBox.height / 2 };
    return [group, { x: center.x, y: center.y }];
  }));
}

function sharedWikiUniversePairs(nodes: WikiNode[]) {
  const pairs = new Set<string>();
  for (const node of nodes) {
    if (!node.id.startsWith("wiki/")) continue;
    const universes = nodeUniverses(node);
    for (let i = 0; i < universes.length; i += 1) {
      for (let j = i + 1; j < universes.length; j += 1) {
        pairs.add(universePairKey(universes[i], universes[j]));
      }
    }
  }
  return pairs;
}

function universePairKey(a: string, b: string) {
  return [a, b].sort((left, right) => left.localeCompare(right)).join("\u0000");
}

function overviewUniverseRadius(groupCount: number) {
  if (groupCount <= 2) return 232;
  if (groupCount <= 4) return 174;
  if (groupCount <= 6) return 148;
  if (groupCount <= 9) return 126;
  return clamp(126 - (groupCount - 9) * 4, 88, 126);
}

function overviewUniverseShellRadius(universeRadius: number) {
  return universeRadius * 1.08 + 22;
}

function groupSphereRadius(count: number) {
  return clamp(112 + Math.sqrt(Math.max(count, 1)) * 23, 148, 310);
}

function fibonacciSpherePoint(index: number, count: number) {
  if (count <= 1) return { x: 0, y: 0, z: 0.86 };
  const offset = 2 / count;
  const y = index * offset - 1 + offset / 2;
  const radial = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = index * 2.399963229728653 + stableHash(String(index + count)) * 0.0000002;
  return {
    x: Math.cos(theta) * radial,
    y,
    z: Math.sin(theta) * radial
  };
}

function buildLargeGraphLayout(nodes: WikiNode[], degree: Map<string, number>): LayoutNode[] {
  const groupBuckets = new Map<string, WikiNode[]>();
  for (const node of nodes) {
    const group = primaryUniverse(node);
    groupBuckets.set(group, [...(groupBuckets.get(group) ?? []), node]);
  }

  const nonWikiGroups = Array.from(groupBuckets.keys())
    .filter((group) => !group.startsWith("Wiki /"))
    .sort((a, b) => (groupBuckets.get(b)?.length ?? 0) - (groupBuckets.get(a)?.length ?? 0) || a.localeCompare(b));
  const groupCenters = new Map<string, { x: number; y: number }>();
  const ringCapacities = [12, 24, 36, 60];
  let groupCursor = 0;

  for (let ring = 0; ring < ringCapacities.length && groupCursor < nonWikiGroups.length; ring += 1) {
    const capacity = ringCapacities[ring];
    const rx = 260 + ring * 145;
    const ry = 165 + ring * 92;
    const groupsOnRing = nonWikiGroups.slice(groupCursor, groupCursor + capacity);
    groupsOnRing.forEach((group, index) => {
      const angle = (Math.PI * 2 * index) / groupsOnRing.length + ring * 0.23;
      groupCenters.set(group, {
        x: viewBox.width / 2 + Math.cos(angle) * rx,
        y: viewBox.height / 2 + Math.sin(angle) * ry
      });
    });
    groupCursor += capacity;
  }

  for (const group of nonWikiGroups.slice(groupCursor)) {
    const index = groupCenters.size;
    const angle = index * 2.399963229728653;
    groupCenters.set(group, {
      x: viewBox.width / 2 + Math.cos(angle) * 540,
      y: viewBox.height / 2 + Math.sin(angle) * 310
    });
  }

  groupCenters.set("Wiki / FlexSim", { x: viewBox.width / 2 - 35, y: viewBox.height / 2 });
  groupCenters.set("Wiki / AI", { x: viewBox.width / 2 + 115, y: viewBox.height / 2 });

  return nodes.map((node) => {
    const group = primaryUniverse(node);
    const bucket = groupBuckets.get(group) ?? [node];
    const index = bucket.findIndex((candidate) => candidate.id === node.id);
    const safeIndex = Math.max(index, 0);
    const center = groupCenters.get(group) ?? { x: viewBox.width / 2, y: viewBox.height / 2 };
    const count = bucket.length;
    const spread =
      group.startsWith("Wiki /") ? 88 :
      count > 120 ? 120 :
      count > 60 ? 96 :
      count > 20 ? 74 :
      48;
    const angle = safeIndex * 2.399963229728653 + stableHash(node.id) * 0.0000007;
    const radius = count <= 1 ? 0 : spread * Math.sqrt((safeIndex + 0.5) / count);
    return {
      ...node,
      degree: degree.get(node.id) ?? 0,
      x: clamp(center.x + Math.cos(angle) * radius, 42, viewBox.width - 42),
      y: clamp(center.y + Math.sin(angle) * radius, 42, viewBox.height - 42)
    };
  });
}

function applyGraphScope(nodes: WikiNode[], graph: WikiGraph | null, selectedId: string | null, scope: GraphScope, depth: number) {
  if (scope === "global") return nodes;
  if (!graph || !selectedId) return [];
  const allowed = new Set(nodes.map((node) => node.id));
  if (!allowed.has(selectedId)) return [];

  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!allowed.has(edge.source) || !allowed.has(edge.target)) continue;
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
    adjacency.set(edge.target, [...(adjacency.get(edge.target) ?? []), edge.source]);
  }

  const visible = new Set([selectedId]);
  let frontier = [selectedId];
  for (let level = 0; level < depth; level += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbor of adjacency.get(id) ?? []) {
        if (visible.has(neighbor)) continue;
        visible.add(neighbor);
        next.push(neighbor);
      }
    }
    frontier = next;
  }

  return nodes.filter((node) => visible.has(node.id));
}

function evidenceIdsForWiki(graph: WikiGraph, wikiId: string) {
  const ids = new Set([wikiId]);
  for (const edge of graph.edges) {
    if (edge.source === wikiId && edge.target.startsWith("raw/")) ids.add(edge.target);
    if (edge.target === wikiId && edge.source.startsWith("raw/")) ids.add(edge.source);
  }
  return ids;
}

function pickLocalCenter(nodes: WikiNode[]) {
  const knowledgeCandidates = nodes.filter((node) => node.id.startsWith("wiki/") && isDefaultLocalCandidate(node));
  if (knowledgeCandidates.length > 0) {
    return [...knowledgeCandidates].sort((a, b) => nodeDegree(b) - nodeDegree(a) || a.title.localeCompare(b.title))[0] ?? null;
  }
  const candidates = nodes.some((node) => node.id.startsWith("wiki/"))
    ? nodes.filter((node) => node.id.startsWith("wiki/"))
    : nodes;
  return [...candidates].sort((a, b) => nodeDegree(b) - nodeDegree(a) || a.title.localeCompare(b.title))[0] ?? null;
}

function isDefaultLocalCandidate(node: WikiNode) {
  const degree = nodeDegree(node);
  const label = `${node.title} ${node.tags.join(" ")}`.toLowerCase();
  return degree > 0 && degree <= 60 && !label.includes("ingest") && !label.includes("qa") && !/^autodesk flexsim \d+ help$/i.test(node.title);
}

function clusterTarget(node: WikiNode, groupIndex = new Map<string, number>(), totalGroups = 1) {
  const section = node.id.split("/")[0];
  if (section === "wiki") return { x: viewBox.width * 0.5, y: viewBox.height * 0.5 };
  if (section === "raw") return groupedTarget(primaryUniverse(node), groupIndex, totalGroups);
  return { x: viewBox.width / 2, y: viewBox.height / 2 };
}

function nodeRadius(node: LayoutNode) {
  if (node.id.startsWith("raw/")) return Math.min(5.4, 2.2 + Math.sqrt(Math.max(node.degree, 1)) * 0.62);
  return Math.min(12.5, 3.6 + Math.sqrt(Math.max(node.degree, 1)) * 1.38);
}

function overviewNodeRadius(node: LayoutNode) {
  return clamp(1.9 + Math.log1p(Math.max(node.degree, 1)) * 0.88, 2.45, 6.35);
}

function nodeDepthScale(node: LayoutNode) {
  return node.depthScale ?? 1;
}

function nodeDepthOpacity(node: LayoutNode) {
  return node.depthOpacity ?? 1;
}

function edgeDepthOpacity(source: LayoutNode, target: LayoutNode) {
  const depth = ((source.depthOpacity ?? 0.75) + (target.depthOpacity ?? 0.75)) / 2;
  return clamp(depth * 0.42, 0.16, 0.55);
}

function buildOverviewEdges(nodes: WikiNode[], explicitEdges: WikiEdge[]) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const existing = new Set(explicitEdges.map((edge) => edgePairKey(edge.source, edge.target)));
  const excludedTags = new Set(["wiki", "concept", "topic", "method", "product", "company", "person", "comparison"]);
  const tagBuckets = new Map<string, WikiNode[]>();

  for (const node of nodes) {
    for (const rawTag of node.tags) {
      const tag = rawTag.trim().toLowerCase();
      if (!tag || excludedTags.has(tag)) continue;
      tagBuckets.set(tag, [...(tagBuckets.get(tag) ?? []), node]);
    }
  }

  const candidates = new Map<string, { source: string; target: string; shared: number }>();
  for (const bucket of tagBuckets.values()) {
    if (bucket.length < 2 || bucket.length > 36) continue;
    for (let left = 0; left < bucket.length; left += 1) {
      for (let right = left + 1; right < bucket.length; right += 1) {
        const source = bucket[left];
        const target = bucket[right];
        if (primaryUniverse(source) === primaryUniverse(target)) continue;
        const key = edgePairKey(source.id, target.id);
        if (existing.has(key)) continue;
        const current = candidates.get(key);
        candidates.set(key, {
          source: source.id,
          target: target.id,
          shared: (current?.shared ?? 0) + 1
        });
      }
    }
  }

  const bridgeLimit = Math.min(240, Math.max(24, Math.ceil(nodes.length * 1.5)));
  const bridges = [...candidates.values()]
    .filter((candidate) => nodeById.has(candidate.source) && nodeById.has(candidate.target))
    .sort((a, b) =>
      b.shared - a.shared ||
      nodeDegree(nodeById.get(b.source)!) + nodeDegree(nodeById.get(b.target)!) - nodeDegree(nodeById.get(a.source)!) - nodeDegree(nodeById.get(a.target)!) ||
      edgePairKey(a.source, a.target).localeCompare(edgePairKey(b.source, b.target))
    )
    .slice(0, bridgeLimit)
    .map(({ source, target }) => ({ source, target, kind: "shared-tag" }));

  return [...explicitEdges, ...bridges];
}

function edgePairKey(source: string, target: string) {
  return [source, target].sort((left, right) => left.localeCompare(right)).join("\u0000");
}

function nodeDegree(node: WikiNode) {
  return node.out.length + node.backlinks.length;
}

function nodeFill(node: WikiNode) {
  const group = primaryUniverse(node);
  if (node.id.startsWith("raw/")) return colorForGroup(group);
  if (node.id.startsWith("wiki/")) return colorForDegree(nodeDegree(node));
  return "#aeb7bd";
}

function colorForDegree(degree: number) {
  const scale = clamp(Math.log1p(Math.max(0, degree)) / Math.log1p(60), 0, 1);
  const stops = [
    { at: 0, color: [103, 166, 161] },
    { at: 0.32, color: [119, 181, 107] },
    { at: 0.62, color: [213, 194, 102] },
    { at: 0.82, color: [210, 154, 84] },
    { at: 1, color: [216, 124, 112] }
  ];
  const upperIndex = stops.findIndex((stop) => stop.at >= scale);
  const upper = stops[Math.max(upperIndex, 0)];
  const lower = stops[Math.max(0, upperIndex - 1)] ?? upper;
  const local = upper.at === lower.at ? 0 : (scale - lower.at) / (upper.at - lower.at);
  const channel = (index: number) => Math.round(lower.color[index] + (upper.color[index] - lower.color[index]) * local);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

function DegreeLegend() {
  const { t } = useI18n();
  return (
    <div className="degree-legend" aria-label={t("degree")}>
      <span>{t("degree")}</span>
      <i />
      <span>{t("high")}</span>
    </div>
  );
}

function buildGroupLabels(layout: LayoutNode[], language: Language): GroupLabel[] {
  const buckets = new Map<string, LayoutNode[]>();
  for (const node of layout) {
    const group = primaryUniverse(node);
    buckets.set(group, [...(buckets.get(group) ?? []), node]);
  }

  return Array.from(buckets.entries())
    .map(([group, nodes]) => {
      const fixedUniverseRadius = nodes[0]?.universeRadius;
      const x = fixedUniverseRadius && nodes[0]?.universeCenterX !== undefined
        ? nodes[0].universeCenterX
        : nodes.reduce((sum, node) => sum + node.x, 0) / nodes.length;
      const y = fixedUniverseRadius && nodes[0]?.universeCenterY !== undefined
        ? nodes[0].universeCenterY
        : nodes.reduce((sum, node) => sum + node.y, 0) / nodes.length;
      const radius = fixedUniverseRadius
        ? overviewUniverseShellRadius(fixedUniverseRadius)
        : Math.max(
          group.startsWith("Wiki /") ? 66 : 44,
          ...nodes.map((node) => Math.hypot(node.x - x, node.y - y) + nodeRadius(node) + 16)
        );
      return {
        group,
        label: groupLabelText(group, language),
        x,
        y,
        count: nodes.length,
        color: colorForGroup(group),
        radius
      };
    })
    .filter((label) => label.count > 0)
    .sort((a, b) => b.count - a.count || a.group.localeCompare(b.group))
    .slice(0, 16);
}

function colorForGroup(group: string) {
  return groupPalette[stableHash(group) % groupPalette.length];
}

function universeGradientId(group: string) {
  return `universe-gradient-${stableHash(group)}`;
}

function groupLabelText(group: string, language: Language = "en") {
  const wikiLabels: Record<string, string> = {
    "Wiki / FlexSim": "Flexsim",
    "Wiki / AI": "AI",
    "Wiki / Other Knowledge": language === "zh" ? "其他知识" : "Other Knowledge"
  };
  const label = wikiLabels[group] ?? group.replace(/^Wiki \/ /, "").replace(/^FlexSim \/ /, "");
  return label.length > 34 ? `${label.slice(0, 32)}...` : label;
}

function primaryUniverse(node: WikiNode) {
  return node.group ?? node.universes?.[0] ?? inferFallbackGroup(node);
}

function nodeUniverses(node: WikiNode) {
  return unique([primaryUniverse(node), ...(node.universes ?? [])].filter(Boolean));
}

function primaryUniverseLabel(node: WikiNode, language: Language = "en") {
  return groupLabelText(primaryUniverse(node), language);
}

function universeListText(node: WikiNode, language: Language = "en") {
  return nodeUniverses(node).map((group) => groupLabelText(group, language)).join(language === "zh" ? "、" : ", ");
}

function groupedTarget(group: string, groupIndex: Map<string, number>, totalGroups: number) {
  const index = groupIndex.get(group) ?? 0;
  const cols = Math.max(2, Math.ceil(Math.sqrt(totalGroups * 1.65)));
  const rows = Math.max(2, Math.ceil(totalGroups / cols));
  const col = index % cols;
  const row = Math.floor(index / cols);
  const xStep = cols === 1 ? 0 : (viewBox.width - 240) / (cols - 1);
  const yStep = rows === 1 ? 0 : (viewBox.height - 180) / (rows - 1);
  return {
    x: 120 + col * xStep,
    y: 90 + row * yStep
  };
}

function localTarget(node: WikiNode, index: number, selectedId: string | null) {
  if (node.id === selectedId) return { x: viewBox.width / 2, y: viewBox.height / 2 };
  const angle = stableHash(node.id) * 0.000001 + index * 2.399963229728653;
  const radius = 120 + (stableHash(node.id) % 180);
  return {
    x: viewBox.width / 2 + Math.cos(angle) * radius,
    y: viewBox.height / 2 + Math.sin(angle) * radius
  };
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function inferFallbackGroup(node: WikiNode) {
  if (node.id.startsWith("raw/autodesk-flexsim-2026/")) return "FlexSim / Corpus";
  if (node.id.startsWith("raw/")) return "Raw / Other";
  if (node.id.startsWith("wiki/")) return inferWikiGroup(node.title, node.tags);
  return node.id.split("/")[0] || "Other";
}

function inferWikiGroup(title: string, tags: string[] = []) {
  const label = `${title} ${tags.join(" ")}`.toLowerCase();
  if (/flexsim/i.test(label)) return "Wiki / FlexSim";
  return "Wiki / AI";
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

const rootElement = document.getElementById("root")!;
const rootHost = window as Window & { __agentWikiDashboardRoot?: ReturnType<typeof createRoot> };
rootHost.__agentWikiDashboardRoot ??= createRoot(rootElement);
rootHost.__agentWikiDashboardRoot.render(<App />);
