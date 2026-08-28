import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  AlertTriangle,
  Check,
  Edit3,
  Eye,
  LoaderCircle,
  PanelLeft,
  Save,
  Settings2,
  Sparkles,
  Trash2,
  Wrench,
  X
} from "lucide-react";
import { AgentInfo, AgentTaskSelection, InboxItem, Job, localApi, MaintenanceResult, MarkdownDocument, RepairResult, TaskProgress, waitForJob } from "./api";
import {
  isUniverseOverviewMode,
  rankUniverseGroupsByConnectivity,
  shouldUseDegreeCenteredUniverseLayout
} from "./layout-mode.js";
import { Viki } from "./Viki";
import { WorkspaceActions } from "./WorkspaceActions";
import { markdownDocumentStats, markdownOutline, type MarkdownOutlineItem } from "./markdown-workspace";
import { visibleGalaxyStats } from "./overview-stats.js";
import "./styles.css";

const richMarkdownModule = import("./RichMarkdown");
const RichMarkdown = lazy(() => richMarkdownModule);
const MarkdownLiveEditor = lazy(() => import("./MarkdownLiveEditor"));

type WikiNode = {
  id: string;
  path: string;
  title: string;
  type: string;
  group?: string;
  universes?: string[];
  status: string;
  tags: string[];
  followupReasons?: string[];
  visualGapPages?: number[];
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
  declaredUniverses?: string[];
  hiddenUniverses?: string[];
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
  query: ""
};

type Language = "en" | "zh";
type CopyVariables = Record<string, string | number>;

const copy = {
  en: {
    graphUnavailable: "Graph unavailable",
    loadingGraph: "Loading graph",
    localWorkspace: "My second brain",
    searchAndFilter: "Search My Wiki knowledge",
    search: "Search",
    searchPlaceholder: "Search concepts, tags, paths",
    clearSearch: "Clear search",
    universe: "Knowledge galaxy",
    allUniverses: "Knowledge universe",
    universeCount: "{count} galaxies",
    back: "Back",
    evidenceTitle: "Evidence: {title}",
    neighbors: "Nearby concept planets",
    degree: "Degree",
    high: "High",
    graphAria: "My Wiki knowledge universe",
    resizePanel: "Resize information panel",
    language: "Language",
    switchChinese: "Switch to Chinese",
    switchEnglish: "Switch to English",
    selectNode: "Select a concept planet",
    evidence: "Evidence ({count})",
    backToKnowledge: "Back to Knowledge",
    status: "Status",
    type: "Type",
    links: "Links",
    backlinks: "Backlinks",
    noWikiText: "No concept content available",
    attention: "Attention",
    brokenPrefix: "Broken",
    gatePrefix: "Gate",
    evidenceLinks: "Evidence Links",
    connectedPages: "Connected Pages",
    noConnectedPages: "No connected pages",
    wikiEvidenceSummary: "{wiki} concept planets, {raw} references",
    visible: "Visible",
    wiki: "Concept planets",
    raw: "References",
    tags: "Tags",
    statuses: "Statuses",
    pending: "Awaiting maintenance",
    inbox: "Inbox",
    processed: "Maintained",
    broken: "Broken",
    centralWikiPages: "Central Concept Planets",
    linkStatus: "{count} links / {status}",
    vaultOverview: "Vault Overview",
    graphHealth: "Graph health for visible knowledge galaxies",
    maintenanceQueue: "Maintenance Queue",
    queueSettings: "Queue agent settings",
    distillAgent: "Distillation",
    repairAgent: "Repair",
    agentCli: "Agent CLI",
    agentModel: "Model",
    cliDefault: "CLI default",
    noPendingRaw: "No references awaiting maintenance",
    processBatch: "Maintain batch",
    maintainBatchConfirm: "Start batch maintenance for {distill} references awaiting distillation and {repair} references awaiting repair?",
    awaitingDistillation: "Awaiting distillation",
    deleteBatch: "Delete all",
    deletingBatch: "Deleting",
    deleteBatchConfirm: "Delete all {count} items awaiting maintenance and their unshared uploaded files? This cannot be undone.",
    deleteBatchPartial: "Deleted {deleted} items; {failed} could not be deleted.",
    processItem: "Maintain this item",
    resolveFollowupFirst: "Resolve the follow-up before maintenance",
    deleteQueueItem: "Delete this queue item",
    deleteQueueConfirm: "Delete \"{title}\" and its unshared uploaded files? This cannot be undone.",
    processingBatch: "Maintaining",
    maintenanceComplete: "Batch maintenance complete",
    maintenanceFailed: "Maintenance failed",
    agentUnavailable: "Local agent unavailable",
    lintRemaining: "{count} vault health issues remain",
    backToGraph: "Back to graph",
    readingMode: "Read",
    editingMode: "Edit",
    liveEditingMode: "Live editing",
    documentOutline: "Document outline",
    noDocumentOutline: "No headings in this document",
    editDocument: "Edit document",
    saveDocument: "Save document",
    cancelEditing: "Cancel editing",
    loadingDocument: "Loading document",
    renderingDocument: "Rendering document",
    renderMoreDocument: "Render more pages",
    retry: "Retry",
    savingDocument: "Saving",
    documentSaved: "Saved",
    unsavedChanges: "You have unsaved changes. Close this document?",
    editorPlaceholder: "Start writing Markdown...",
    uploadingImage: "Adding image",
    imageUploadFailed: "Could not add image",
    documentStats: "{words} words · {characters} characters · {lines} lines",
    unsavedDocument: "Unsaved",
    imageUnavailable: "Local image unavailable",
    repairItem: "Repair this reference",
    repairingItem: "Repairing reference",
    repairComplete: "Reference repair complete",
    repairStillBlocked: "Reference still needs follow-up",
    repairFailed: "Reference repair failed",
    queuedTask: "Queued",
    extractingTask: "Extracting",
    distillingTask: "Distilling",
    repairingTask: "Repairing"
  },
  zh: {
    graphUnavailable: "知识图谱不可用",
    loadingGraph: "正在加载知识图谱",
    localWorkspace: "我的第二大脑",
    searchAndFilter: "搜索 My Wiki 知识",
    search: "搜索",
    searchPlaceholder: "搜索概念、标签或路径",
    clearSearch: "清空搜索",
    universe: "知识星系",
    allUniverses: "知识宇宙",
    universeCount: "{count} 个星系",
    back: "返回",
    evidenceTitle: "证据：{title}",
    neighbors: "邻近概念星球",
    degree: "连接度",
    high: "高",
    graphAria: "My Wiki 知识宇宙",
    resizePanel: "调整信息面板宽度",
    language: "语言",
    switchChinese: "切换为中文",
    switchEnglish: "切换为英文",
    selectNode: "请选择一个概念星球",
    evidence: "查看证据（{count}）",
    backToKnowledge: "返回知识层",
    status: "状态",
    type: "类型",
    links: "链接",
    backlinks: "反向链接",
    noWikiText: "暂无概念正文",
    attention: "需要注意",
    brokenPrefix: "断裂链接",
    gatePrefix: "维护门槛",
    evidenceLinks: "证据链接",
    connectedPages: "关联页面",
    noConnectedPages: "暂无关联页面",
    wikiEvidenceSummary: "{wiki} 个概念星球，{raw} 条参考资料",
    visible: "当前显示",
    wiki: "概念星球",
    raw: "参考资料",
    tags: "标签",
    statuses: "状态类型",
    pending: "待维护",
    inbox: "收件箱",
    processed: "已维护",
    broken: "断裂链接",
    centralWikiPages: "核心概念星球",
    linkStatus: "{count} 条链接 / {status}",
    vaultOverview: "知识库概览",
    graphHealth: "当前显示星系的图谱健康与维护状态",
    maintenanceQueue: "维护队列",
    queueSettings: "队列 Agent 设置",
    distillAgent: "蒸馏",
    repairAgent: "修复",
    agentCli: "Agent CLI",
    agentModel: "模型",
    cliDefault: "CLI 默认",
    noPendingRaw: "没有待维护的参考资料",
    processBatch: "批量维护",
    maintainBatchConfirm: "将开始维护：待蒸馏 {distill} 条，待修复 {repair} 条。确认继续吗？",
    awaitingDistillation: "待蒸馏",
    deleteBatch: "批量删除",
    deletingBatch: "正在删除",
    deleteBatchConfirm: "确定删除全部 {count} 条待维护资料及其未被其他条目共享的上传文件吗？此操作无法撤销。",
    deleteBatchPartial: "已删除 {deleted} 条，另有 {failed} 条因引用保护等原因无法删除。",
    processItem: "维护此条知识",
    resolveFollowupFirst: "请先解决待跟进问题，再进行维护",
    deleteQueueItem: "删除此条待维护资料",
    deleteQueueConfirm: "确定删除“{title}”及其未被其他条目共享的上传文件吗？此操作无法撤销。",
    processingBatch: "正在维护",
    maintenanceComplete: "本批维护完成",
    maintenanceFailed: "维护失败",
    agentUnavailable: "本地 Agent 不可用",
    lintRemaining: "仍有 {count} 个知识库健康问题",
    backToGraph: "返回图谱",
    readingMode: "阅读",
    editingMode: "编辑",
    liveEditingMode: "实时编辑",
    documentOutline: "文档大纲",
    noDocumentOutline: "本文档没有标题",
    editDocument: "编辑文档",
    saveDocument: "保存文档",
    cancelEditing: "取消编辑",
    loadingDocument: "正在加载文档",
    renderingDocument: "正在渲染文档",
    renderMoreDocument: "继续渲染后续页面",
    retry: "重试",
    savingDocument: "正在保存",
    documentSaved: "已保存",
    unsavedChanges: "文档还有未保存的修改，确定关闭吗？",
    editorPlaceholder: "开始编写 Markdown...",
    uploadingImage: "正在添加图片",
    imageUploadFailed: "图片添加失败",
    documentStats: "{words} 词 · {characters} 字符 · {lines} 行",
    unsavedDocument: "未保存",
    imageUnavailable: "本地图片不可用",
    repairItem: "修复这条参考资料",
    repairingItem: "正在修复参考资料",
    repairComplete: "参考资料修复完成",
    repairStillBlocked: "参考资料仍需跟进",
    repairFailed: "参考资料修复失败",
    queuedTask: "等待执行",
    extractingTask: "正在提取",
    distillingTask: "正在蒸馏",
    repairingTask: "正在修复"
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
    inbox: "待维护",
    processed: "已维护",
    "needs-followup": "待跟进",
    stale: "已过期",
    unknown: "未知"
  };
  return statuses[value.toLowerCase()] ?? value;
}

function localizedFollowupReason(value: string, language: Language) {
  const reason = value.trim().toLowerCase();
  if (reason.startsWith("missing-visual-evidence:")) {
    const detail = value.slice(value.indexOf(":") + 1).replace(/^pages=/i, language === "zh" ? "页码 " : "pages ");
    return language === "zh" ? `PDF 页面图片或图形证据缺失（${detail}）` : `PDF visual evidence is missing (${detail})`;
  }
  if (reason.startsWith("formula-syntax-error:")) {
    const detail = value.slice(value.indexOf(":") + 1).replace(/^pages=/i, language === "zh" ? "页码 " : "pages ");
    return language === "zh" ? `公式语法无法渲染（${detail}）` : `Formula syntax cannot render (${detail})`;
  }
  if (reason.startsWith("formula-strict-warning:")) {
    const detail = value.slice(value.indexOf(":") + 1).replace(/^pages=/i, language === "zh" ? "页码 " : "pages ");
    return language === "zh" ? `公式结构可疑（${detail}）` : `Formula structure needs repair (${detail})`;
  }
  const messages: Record<string, { en: string; zh: string }> = {
    "extraction:low-quality": { en: "PDF OCR quality is too low", zh: "PDF OCR 质量不足" },
    "extraction:failed": { en: "File extraction failed", zh: "文件提取失败" },
    "extraction:partial": { en: "File extraction is incomplete", zh: "文件提取不完整" },
    "extraction:empty": { en: "No readable content was extracted", zh: "未提取到可读正文" },
    "extraction:skipped-large": { en: "File exceeds the automatic extraction limit", zh: "文件超出自动提取范围" },
    "capture:needs-followup": { en: "The captured source needs review", zh: "来源内容需要人工检查" }
  };
  const message = messages[reason];
  if (message) return message[language];
  return language === "zh" ? `需要跟进：${value}` : `Follow-up required: ${value}`;
}

function localizedVisualGap(pages: number[], language: Language) {
  const detail = pages.join(", ");
  return language === "zh"
    ? `疑似缺失 PDF 页面图片或图形证据（页码 ${detail}）`
    : `PDF page images or visual evidence may be missing (pages ${detail})`;
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
    "raw-source": "参考资料",
    reference: "参考资料"
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
  const [markdownPath, setMarkdownPath] = useState<string | null>(null);
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
    window.addEventListener("my-wiki:graph-updated", refreshOnFocus);
    return () => {
      cancelled = true;
      window.clearInterval(refreshId);
      window.removeEventListener("focus", refreshOnFocus);
      window.removeEventListener("my-wiki:graph-updated", refreshOnFocus);
    };
  }, []);

  const nodeById = useMemo(() => new Map((graph?.nodes ?? []).map((node) => [node.id, node])), [graph]);
  const wikiFilteredNodes = useMemo(() => {
    if (!graph) return [];
    const needle = filters.query.trim().toLowerCase();
    const hasSearch = needle !== "";
    const wikiNodes = graph.nodes.filter((node) => {
      if (!node.id.startsWith("concepts/")) return false;
      if (!hasSearch) return true;
      const universes = nodeUniverses(node);
      const searchable = [node.title, node.path, node.type, node.status, ...universes, ...node.tags].join(" ").toLowerCase();
      return searchable.includes(needle);
    });
    const represented = new Set(wikiNodes.map((node) => nodeUniverses(node)[0]).filter(Boolean).map((item) => item.toLocaleLowerCase()));
    const placeholders = (graph.declaredUniverses ?? [])
      .filter((universe) => !represented.has(universe.toLocaleLowerCase()))
      .filter((universe) => !hasSearch || universe.toLocaleLowerCase().includes(needle))
      .map(declaredUniversePlaceholder);
    return [...wikiNodes, ...placeholders];
  }, [graph, filters]);

  const evidenceCenterId = useMemo(() => {
    if (graphMode !== "evidence") return null;
    if (evidenceWikiId && nodeById.get(evidenceWikiId)?.id.startsWith("concepts/")) return evidenceWikiId;
    if (selectedId && nodeById.get(selectedId)?.id.startsWith("concepts/")) return selectedId;
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
    if (graphScope === "global") {
      const hidden = new Set((graph.hiddenUniverses ?? []).map(galaxyKey));
      if (hidden.size > 0) return wikiFilteredNodes.flatMap((node) => {
        const visibleUniverses = nodeUniverses(node).filter((name) => !hidden.has(galaxyKey(name)));
        return visibleUniverses.length > 0 ? [{ ...node, group: visibleUniverses[0], universes: visibleUniverses }] : [];
      });
    }
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
  const isUniverseOverview = isUniverseOverviewMode({ graphMode, graphScope, focusedGroup });
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
  const layout = useMemo(
    () => buildLayout(filteredNodes, displayEdges, layoutScope, layoutCenterId, layoutRotation, isUniverseOverview),
    [filteredNodes, displayEdges, layoutScope, layoutCenterId, layoutRotation, isUniverseOverview]
  );
  const layoutById = useMemo(() => new Map(layout.map((node) => [node.id, node])), [layout]);
  const selected = activeSelectedId ? nodeById.get(activeSelectedId) ?? null : null;
  const evidenceCenter = evidenceCenterId ? nodeById.get(evidenceCenterId) ?? null : null;
  const panelNode = graphMode === "evidence" ? evidenceCenter : selected;
  const evidenceButtonId = useMemo(() => {
    if (activeSelectedId && nodeById.get(activeSelectedId)?.id.startsWith("concepts/")) return activeSelectedId;
    if (selectedId && nodeById.get(selectedId)?.id.startsWith("concepts/")) return selectedId;
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
    if (!node?.id.startsWith("concepts/")) return;
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

  const openMarkdown = (node: WikiNode) => {
    setMarkdownPath(node.path);
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
      <>
        <main className="empty-state">
          <h1>{t("graphUnavailable")}</h1>
          <p>{loadError}</p>
        </main>
        <Viki language={language} />
      </>
    );
  }

  if (!graph) {
    return (
      <>
        <main className="empty-state">
          <h1>{t("loadingGraph")}</h1>
        </main>
        <Viki language={language} />
      </>
    );
  }

  return (
    <I18nContext.Provider value={i18n}>
      <>
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
            <span className="search-input-wrap">
              <input value={filters.query} onChange={(event) => setFilters({ ...filters, query: event.target.value })} placeholder={t("searchPlaceholder")} />
              {filters.query ? (
                <button className="clear-search-button" type="button" aria-label={t("clearSearch")} onClick={() => setFilters({ ...filters, query: "" })}>
                  x
                </button>
              ) : null}
            </span>
          </label>
          <WorkspaceActions language={language} />
          <div className="language-control">
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
          onClearSelection={() => setSelectedId(null)}
          onOpenEvidence={openEvidence}
          onOpenMarkdown={openMarkdown}
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
          visibleEdges={displayEdges.length}
          onSelect={setSelectedId}
          onOpenEvidence={openEvidence}
          onBackToKnowledge={backToKnowledge}
        />
      </aside>
      <Viki language={language} />
      </main>
      {markdownPath && <MarkdownWorkspace path={markdownPath} onClose={() => setMarkdownPath(null)} />}
      </>
    </I18nContext.Provider>
  );
}

function MarkdownWorkspace({ path, onClose }: { path: string; onClose: () => void }) {
  const { t } = useI18n();
  const [document, setDocument] = useState<MarkdownDocument | null>(null);
  const [draft, setDraft] = useState("");
  const [savedBody, setSavedBody] = useState("");
  const [mode, setMode] = useState<"read" | "edit">("read");
  const [outlineVisible, setOutlineVisible] = useState(() => !window.matchMedia("(max-width: 760px)").matches);
  const [renderAll, setRenderAll] = useState(false);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const liveEditorRef = useRef<HTMLDivElement | null>(null);
  const dirty = draft !== savedBody;
  const outline = useMemo(() => markdownOutline(draft), [draft]);
  const stats = useMemo(() => markdownDocumentStats(draft), [draft]);

  useEffect(() => {
    window.document.body.classList.add("has-markdown-workspace");
    return () => window.document.body.classList.remove("has-markdown-workspace");
  }, []);

  useEffect(() => {
    const narrowViewport = window.matchMedia("(max-width: 760px)");
    const closeOutline = (event: MediaQueryListEvent) => {
      if (event.matches) setOutlineVisible(false);
    };
    if (narrowViewport.matches) setOutlineVisible(false);
    narrowViewport.addEventListener("change", closeOutline);
    return () => narrowViewport.removeEventListener("change", closeOutline);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setDocument(null);
    setLoadError("");
    setSaveError("");
    setSaved(false);
    setMode("read");
    setRenderAll(false);
    void localApi.markdown(path)
      .then((next) => {
        if (cancelled) return;
        setDocument(next);
        setDraft(next.body);
        setSavedBody(next.body);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [loadAttempt, path]);

  useEffect(() => {
    if (!document) return;
    let cancelled = false;
    const sources = extractMarkdownImageSources(draft).filter(isLocalMarkdownImageSource);
    void Promise.all(sources.map(async (source) => [source, await localApi.markdownImageUrl(document.path, source)] as const))
      .then((entries) => {
        if (cancelled) return;
        const urls: Record<string, string> = {};
        for (const [source, url] of entries) {
          urls[source] = url;
          try {
            urls[encodeURI(source)] = url;
          } catch {
            // The original source remains available as a lookup key.
          }
        }
        setImageUrls(urls);
      })
      .catch(() => {
        if (!cancelled) setImageUrls({});
      });
    return () => {
      cancelled = true;
    };
  }, [document?.path, draft]);

  useEffect(() => {
    if (!dirty) return;
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [dirty]);

  const closeWorkspace = () => {
    if (dirty && !window.confirm(t("unsavedChanges"))) return;
    onClose();
  };

  const cancelEditing = () => {
    if (dirty && !window.confirm(t("unsavedChanges"))) return;
    setDraft(savedBody);
    setSaveError("");
    setMode("read");
  };

  const saveDocument = async (body = draft) => {
    if (!document || saving || body === savedBody) return;
    setSaving(true);
    setSaveError("");
    setSaved(false);
    try {
      const next = await localApi.saveMarkdown(document.path, body, document.version);
      setDocument(next);
      setDraft(next.body);
      setSavedBody(next.body);
      setSaved(true);
      window.dispatchEvent(new Event("my-wiki:graph-updated"));
      window.setTimeout(() => setSaved(false), 1800);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const uploadImage = async (file: File): Promise<string> => {
    if (!document) throw new Error(t("imageUploadFailed"));
    setUploadingImage(true);
    setSaveError("");
    try {
      const uploaded = await localApi.uploadMarkdownImage(document.path, file);
      return uploaded.source;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setSaveError(`${t("imageUploadFailed")}: ${detail}`);
      throw error;
    } finally {
      setUploadingImage(false);
    }
  };

  const jumpToOutline = (item: MarkdownOutlineItem) => {
    if (mode === "edit") {
      const headings = Array.from(liveEditorRef.current?.querySelectorAll("h1, h2, h3, h4") || []);
      const target = headings.find((heading) => heading.textContent?.trim() === item.text);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setRenderAll(true);
    window.setTimeout(() => window.document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 40);
  };

  return (
    <section className="markdown-workspace" role="dialog" aria-modal="true" aria-label={document?.title ?? path}>
      <header className="markdown-workspace-header">
        <button className="document-icon-button" type="button" onClick={closeWorkspace} title={t("backToGraph")} aria-label={t("backToGraph")}>
          <ArrowLeft size={18} />
        </button>
        <div className="document-breadcrumb">
          <strong>{document?.title ?? t("loadingDocument")}</strong>
          <span>{document?.path ?? path}</span>
        </div>
        {document && (
          <>
            <div className="document-mode-switch" role="group" aria-label={t("editingMode")}>
              <button type="button" className={mode === "read" ? "is-active" : ""} onClick={() => setMode("read")} title={t("readingMode")}>
                <Eye size={16} />
                <span>{t("readingMode")}</span>
              </button>
              <button type="button" className={mode === "edit" ? "is-active" : ""} onClick={() => setMode("edit")} title={t("editDocument")}>
                <Edit3 size={16} />
                <span>{t("liveEditingMode")}</span>
              </button>
            </div>
            <button
              className={`document-icon-button${outlineVisible ? " is-active" : ""}`}
              type="button"
              onClick={() => setOutlineVisible((value) => !value)}
              title={t("documentOutline")}
              aria-label={t("documentOutline")}
              aria-pressed={outlineVisible}
            >
              <PanelLeft size={17} />
            </button>
            <div className="document-save-state" aria-live="polite">
              {saving && <><LoaderCircle className="spin" size={15} /> {t("savingDocument")}</>}
              {saved && <><Check size={15} /> {t("documentSaved")}</>}
              {!saving && !saved && dirty && <>{t("unsavedDocument")}</>}
            </div>
            {mode !== "read" && (
              <div className="document-header-actions">
                <button className="document-icon-button" type="button" onClick={cancelEditing} title={t("cancelEditing")} aria-label={t("cancelEditing")}>
                  <X size={18} />
                </button>
                <button className="document-save-button" type="button" onClick={() => void saveDocument()} disabled={!dirty || saving}>
                  {saving ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}
                  <span>{t("saveDocument")}</span>
                </button>
              </div>
            )}
          </>
        )}
      </header>

      <main className={`markdown-workspace-main is-${mode}${outlineVisible ? " has-outline" : ""}`}>
        {document && outlineVisible && (
          <aside className="document-outline" aria-label={t("documentOutline")}>
            <strong>{t("documentOutline")}</strong>
            {outline.length ? (
              <nav>
                {outline.map((item, index) => (
                  <button
                    key={`${item.id}-${index}`}
                    className={`is-level-${item.level}`}
                    type="button"
                    onClick={() => jumpToOutline(item)}
                    title={item.text}
                  >
                    {item.text}
                  </button>
                ))}
              </nav>
            ) : <p>{t("noDocumentOutline")}</p>}
          </aside>
        )}
        <div className="document-workspace-content">
          {!document && !loadError && (
            <div className="document-state">
              <LoaderCircle className="spin" size={24} />
              <p>{t("loadingDocument")}</p>
            </div>
          )}
          {loadError && (
            <div className="document-state is-error">
              <p>{loadError}</p>
              <button type="button" onClick={() => setLoadAttempt((value) => value + 1)}>{t("retry")}</button>
            </div>
          )}
          {document && mode === "read" && (
            <article className="document-page">
              <Suspense fallback={<div className="document-state"><LoaderCircle className="spin" size={24} /></div>}>
                <RichMarkdown
                  content={draft}
                  imageUrls={imageUrls}
                  imageFallback={t("imageUnavailable")}
                  renderingLabel={t("renderingDocument")}
                  renderMoreLabel={t("renderMoreDocument")}
                  renderAll={renderAll}
                />
              </Suspense>
            </article>
          )}
          {document && mode !== "read" && (
          <section className="document-editor" ref={liveEditorRef}>
            <Suspense fallback={<div className="document-state"><LoaderCircle className="spin" size={24} /></div>}>
              <MarkdownLiveEditor
                markdown={draft}
                title={document.title}
                placeholder={t("editorPlaceholder")}
                onChange={(next) => {
                  setDraft(next);
                  setSaved(false);
                }}
                onSave={(next) => void saveDocument(next)}
                onUploadImage={uploadImage}
                resolveImageUrl={(source) => localApi.markdownImageUrl(document.path, source)}
              />
            </Suspense>
            <footer className="document-editor-status">
              <span>{t("documentStats", stats)}</span>
              {uploadingImage && <span><LoaderCircle className="spin" size={13} /> {t("uploadingImage")}</span>}
            </footer>
            {saveError && <p className="document-save-error" role="alert">{saveError}</p>}
          </section>
          )}
        </div>
      </main>
    </section>
  );
}

function extractMarkdownImageSources(content: string) {
  const sources = new Set<string>();
  const inlinePattern = /!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/g;
  const definitionPattern = /^\s*\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/gm;
  for (const pattern of [inlinePattern, definitionPattern]) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content))) {
      const source = (match[1] || match[2] || "").trim();
      if (source) sources.add(source);
    }
  }
  return [...sources];
}

function isLocalMarkdownImageSource(source: string) {
  const value = source.trim();
  return Boolean(value) && !value.startsWith("#") && !value.startsWith("//") && !/^[a-z][a-z0-9+.-]*:/i.test(value);
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
  onClearSelection,
  onOpenEvidence,
  onOpenMarkdown,
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
  onClearSelection: () => void;
  onOpenEvidence: (id: string) => void;
  onOpenMarkdown: (node: WikiNode) => void;
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
              if (selectedId) {
                onClearSelection();
                return;
              }
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
      onClickCapture={(event) => {
        if (!selectedId || draggedRef.current) return;
        const target = event.target as Element;
        if (target.closest(".graph-node, .group-name")) return;
        event.stopPropagation();
        onClearSelection();
      }}
      onClick={() => {
        if (draggedRef.current) {
          draggedRef.current = false;
          return;
        }
        onClearSelection();
      }}
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
          if (node.type === "declared-universe") return null;
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
              onClick={(event) => {
                event.stopPropagation();
                if (draggedRef.current) {
                  draggedRef.current = false;
                  return;
                }
                onSelect(node.id);
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                if (draggedRef.current) return;
                if (graphMode === "evidence") onOpenMarkdown(node);
                else onOpenEvidence(node.id);
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
  const isWikiNode = node.id.startsWith("concepts/");
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
  visibleEdges,
  onSelect
}: {
  graph: WikiGraph;
  group: string;
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
        visibleEdges={visibleEdges}
        items={[
          [t("wiki"), summary.wikiNodes.length],
          [t("raw"), summary.evidenceCount],
          [t("links"), visibleEdges],
          [t("tags"), summary.tagCount]
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
  visibleEdges,
  onSelect
}: {
  graph: WikiGraph;
  nodeById: Map<string, WikiNode>;
  visibleEdges: number;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  const scopedStats = useMemo(() => visibleGalaxyStats(graph), [graph]);
  return (
    <section className="global-overview">
      <header>
        <h2>{t("vaultOverview")}</h2>
        <p>{t("graphHealth")}</p>
      </header>
      <Stats stats={scopedStats} visibleEdges={visibleEdges} />
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

function Stats({ graph, stats, visibleEdges, items }: { graph?: WikiGraph; stats?: Record<string, number>; visibleEdges: number; items?: Array<[string, number]> }) {
  const { t } = useI18n();
  const values = stats ?? graph?.stats ?? {};
  const defaultItems: Array<[string, number]> = [
    [t("wiki"), values.wikiPages ?? 0],
    [t("raw"), values.rawSources ?? 0],
    [t("links"), visibleEdges],
    [t("broken"), values.unresolved ?? 0],
    [t("inbox"), values.inbox ?? 0],
    [t("processed"), values.processed ?? 0]
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
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set());
  const ids = [...new Set([...graph.queues.inbox, ...graph.queues.needsFollowup, ...graph.queues.stale])]
    .filter((id) => id.startsWith("references/sources/") && !deletedIds.has(id));
  const nodes = ids.map((id) => nodeById.get(id)).filter(Boolean) as WikiNode[];
  const batchNodes = nodes.slice(0, 500);
  const [agentState, setAgentState] = useState<AgentInfo | null>(null);
  const [captureItems, setCaptureItems] = useState<InboxItem[]>([]);
  const [activeJobs, setActiveJobs] = useState<Map<string, Job>>(() => new Map());
  const [pendingPaths, setPendingPaths] = useState<Set<string>>(() => new Set());
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  const [deletingBatch, setDeletingBatch] = useState(false);
  const [result, setResult] = useState<MaintenanceResult | null>(null);
  const [repairResult, setRepairResult] = useState<RepairResult | null>(null);
  const [error, setError] = useState("");
  const [errorAction, setErrorAction] = useState<"maintenance" | "repair">("maintenance");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [queueAgentSettings, setQueueAgentSettings] = useState<QueueAgentSettings>(() => loadQueueAgentSettings());

  useEffect(() => {
    const refresh = async () => {
      const [agent, captures] = await Promise.all([localApi.agent(), localApi.captureJobs()]);
      setAgentState(agent);
      setActiveJobs(new Map((agent.activeRawJobs || []).flatMap((job) => rawJobPath(job) ? [[rawJobPath(job), job] as const] : [])));
      setCaptureItems(captures.items.filter((item) => item.jobId && ["queued", "running", "failed"].includes(item.jobStatus || "")));
    };
    void refresh().catch(() => setAgentState(null));
    const timer = window.setInterval(() => void refresh().catch(() => {}), 1500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!agentState?.available) return;
    setQueueAgentSettings((current) => normalizeQueueAgentSettings(agentState, current));
  }, [agentState]);

  useEffect(() => {
    persistQueueAgentSettings(queueAgentSettings);
  }, [queueAgentSettings]);

  const processNodes = async (selectedNodes: WikiNode[], confirmBatch = false) => {
    if (selectedNodes.length === 0 || !agentState?.available) return;
    if (confirmBatch) {
      const repair = selectedNodes.filter((node) => node.status === "needs-followup").length;
      const distill = selectedNodes.length - repair;
      if (!window.confirm(t("maintainBatchConfirm", { distill, repair }))) return;
    }
    setError("");
    setErrorAction("maintenance");
    setResult(null);
    setRepairResult(null);
    const selectedPaths = selectedNodes.map((node) => node.path);
    setPendingPaths((current) => new Set([...current, ...selectedPaths]));
    try {
      const normalizedSettings = normalizeQueueAgentSettings(agentState, queueAgentSettings);
      const distillSelection = normalizedSettings.distill;
      const outcome = selectedNodes.length === 1 && selectedNodes[0].status !== "needs-followup"
        ? { jobs: [await localApi.maintain([selectedNodes[0].path], 1, distillSelection)] }
        : await localApi.maintainBatch(selectedNodes.map((node) => node.path), selectedNodes.length, normalizedSettings);
      setActiveJobs((current) => new Map([
        ...current,
        ...outcome.jobs.flatMap((job) => rawJobPath(job) ? [[rawJobPath(job), job] as const] : [])
      ]));
      setPendingPaths((current) => new Set([...current].filter((item) => !selectedPaths.includes(item))));
      const settled = await Promise.allSettled(outcome.jobs.map(async (job) => {
        try {
          return await waitForJob(job);
        } finally {
          window.dispatchEvent(new Event("my-wiki:graph-updated"));
          const agent = await localApi.agent().catch(() => null);
          if (agent) setAgentState(agent);
        }
      }));
      const completed = settled.flatMap((item) => item.status === "fulfilled" ? [item.value] : []);
      const latestMaintenance = [...completed].reverse().find((job) => job.type === "agent-maintenance");
      if (latestMaintenance?.result) setResult(latestMaintenance.result as MaintenanceResult);
      const failed = settled.filter((item) => item.status === "rejected");
      if (failed.length) setError(failed.map((item) => item.status === "rejected" ? item.reason?.message || String(item.reason) : "").join("；"));
      setAgentState(await localApi.agent());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      localApi.agent().then(setAgentState).catch(() => {});
    } finally {
      setPendingPaths((current) => new Set([...current].filter((item) => !selectedPaths.includes(item))));
    }
  };

  const repairNode = async (node: WikiNode) => {
    if (node.status !== "needs-followup" || activeJobs.has(node.path) || pendingPaths.has(node.path) || !agentState?.available) return;
    setError("");
    setErrorAction("repair");
    setResult(null);
    setRepairResult(null);
    setPendingPaths((current) => new Set(current).add(node.path));
    try {
      const normalizedSettings = normalizeQueueAgentSettings(agentState, queueAgentSettings);
      const initial = await localApi.repair(node.path, normalizedSettings.repair);
      setActiveJobs((current) => new Map(current).set(node.path, initial));
      setPendingPaths((current) => { const next = new Set(current); next.delete(node.path); return next; });
      const complete = await waitForJob(initial);
      setRepairResult(complete.result as RepairResult);
      setAgentState(await localApi.agent());
      window.dispatchEvent(new Event("my-wiki:graph-updated"));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      localApi.agent().then(setAgentState).catch(() => {});
    } finally {
      setPendingPaths((current) => { const next = new Set(current); next.delete(node.path); return next; });
    }
  };

  const deleteNode = async (node: WikiNode) => {
    if (activeJobs.has(node.path) || pendingPaths.has(node.path) || deletingPath || deletingBatch) return;
    if (!window.confirm(t("deleteQueueConfirm", { title: node.title }))) return;
    setDeletingPath(node.path);
    setError("");
    setResult(null);
    setRepairResult(null);
    try {
      await localApi.deleteQueueItem(node.path);
      setDeletedIds((current) => new Set(current).add(node.id));
      window.dispatchEvent(new Event("my-wiki:graph-updated"));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setDeletingPath(null);
    }
  };

  const deleteAllNodes = async () => {
    if (nodes.length === 0 || deletingPath || deletingBatch) return;
    if (!window.confirm(t("deleteBatchConfirm", { count: nodes.length }))) return;
    setDeletingBatch(true);
    setError("");
    setResult(null);
    setRepairResult(null);
    try {
      const outcome = await localApi.deleteQueueItems(nodes.map((node) => node.path));
      const deletedPaths = new Set(outcome.deleted.map((item) => item.path));
      setDeletedIds((current) => {
        const next = new Set(current);
        for (const node of nodes) if (deletedPaths.has(node.path)) next.add(node.id);
        return next;
      });
      if (outcome.failed.length > 0) {
        setError(t("deleteBatchPartial", { deleted: outcome.count, failed: outcome.failed.length }));
      }
      window.dispatchEvent(new Event("my-wiki:graph-updated"));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setDeletingBatch(false);
    }
  };

  return (
    <section className="queue-panel">
      <div className="queue-heading">
        <h2>{t("maintenanceQueue")} <span className="queue-count">{nodes.length + captureItems.length}</span></h2>
        <div className="queue-heading-actions">
          <button
            type="button"
            className={`queue-settings-button${settingsOpen ? " active" : ""}`}
            aria-label={t("queueSettings")}
            title={t("queueSettings")}
            disabled={!agentState?.available}
            onClick={() => setSettingsOpen((current) => !current)}
          >
            <Settings2 size={15} />
          </button>
          <button
            type="button"
            className="maintenance-button"
            disabled={batchNodes.length === 0 || Boolean(deletingPath) || deletingBatch || !agentState?.available}
            title={agentState?.available === false ? t("agentUnavailable") : t("processBatch")}
            onClick={() => void processNodes(batchNodes, true)}
          >
            <Sparkles size={14} />
            {t("processBatch")}
          </button>
          <button
            type="button"
            className="batch-delete-button"
            disabled={nodes.length === 0 || Boolean(deletingPath) || deletingBatch}
            title={t("deleteBatch")}
            onClick={() => void deleteAllNodes()}
          >
            {deletingBatch ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />}
            {deletingBatch ? t("deletingBatch") : t("deleteBatch")}
          </button>
        </div>
      </div>
      {settingsOpen && agentState?.available ? (
        <div className="queue-agent-settings" aria-label={t("queueSettings")}>
          {(["repair", "distill"] as const).map((kind) => {
            const selection = queueAgentSettings[kind];
            const providerInfo = agentState.providers.find((item) => item.provider === selection.provider) || agentState.providers[0];
            return (
              <div className="queue-agent-setting" key={kind}>
                <strong>{t(kind === "repair" ? "repairAgent" : "distillAgent")}</strong>
                <label>
                  <span>{t("agentCli")}</span>
                  <select
                    value={selection.provider}
                    onChange={(event) => setQueueAgentSettings((current) => ({
                      ...current,
                      [kind]: { provider: event.target.value, model: "" }
                    }))}
                  >
                    {agentState.providers.map((provider) => <option value={provider.provider} key={provider.provider}>{provider.label}</option>)}
                  </select>
                </label>
                <label>
                  <span>{t("agentModel")}</span>
                  <select
                    value={selection.model}
                    onChange={(event) => setQueueAgentSettings((current) => ({
                      ...current,
                      [kind]: { ...current[kind], model: event.target.value }
                    }))}
                  >
                    <option value="">{t("cliDefault")}{providerInfo?.defaultModel ? ` · ${providerInfo.defaultModel}` : ""}</option>
                    {(providerInfo?.models || []).map((model) => <option value={model.id} key={model.id}>{model.label}</option>)}
                  </select>
                </label>
              </div>
            );
          })}
        </div>
      ) : null}
      {nodes.length === 0 && captureItems.length === 0 ? (
        <p className="muted">{t("noPendingRaw")}</p>
      ) : (
        <div className="queue-list">
          {captureItems.map((item) => (
            <div className="queue-item queue-item-extracting" key={`capture:${item.jobId}`}>
              <div className="queue-item-main">
                <strong>{item.title}</strong>
                <span>{item.jobStatus === "failed" ? item.preview : item.jobStatus === "queued" ? t("queuedTask") : t("extractingTask")}</span>
                {item.progress ? <QueueProgress progress={item.progress} language={language} /> : null}
              </div>
              <div className="queue-item-actions">{item.jobStatus === "failed" ? <AlertTriangle size={14} /> : <LoaderCircle className="spin" size={14} />}</div>
            </div>
          ))}
          {nodes.map((node) => (
            <div className="queue-item" key={node.id}>
              <button className="queue-item-main" type="button" onClick={() => onSelect(node.id)}>
                <strong>{node.title}</strong>
                <span>{pendingPaths.has(node.path) ? t("queuedTask") : rawTaskLabel(activeJobs.get(node.path), language) || (node.status === "needs-followup" ? localizedStatus(node.status, language) : t("awaitingDistillation"))}</span>
                {node.status === "needs-followup" && node.visualGapPages?.length ? (
                  <small className="queue-item-followup">{localizedVisualGap(node.visualGapPages, language)}</small>
                ) : node.status === "needs-followup" && node.followupReasons?.length ? (
                  <small className="queue-item-followup">{localizedFollowupReason(node.followupReasons[0], language)}</small>
                ) : null}
              </button>
              <div className="queue-item-actions">
                {(() => {
                  const repairing = node.status === "needs-followup";
                  const actionLabel = repairing ? t("repairItem") : t("processItem");
                  return (
                <button
                  className={`queue-item-process${repairing ? " queue-item-repair" : ""}`}
                  type="button"
                  aria-label={actionLabel}
                  title={agentState?.available === false ? t("agentUnavailable") : actionLabel}
                  disabled={pendingPaths.has(node.path) || activeJobs.has(node.path) || Boolean(deletingPath) || deletingBatch || !agentState?.available}
                  onClick={() => void (repairing ? repairNode(node) : processNodes([node]))}
                >
                  {pendingPaths.has(node.path) || activeJobs.has(node.path) ? <LoaderCircle className="spin" size={14} /> : repairing ? <Wrench size={14} /> : <Sparkles size={14} />}
                </button>
                  );
                })()}
                <button
                  className="queue-item-delete"
                  type="button"
                  aria-label={t("deleteQueueItem")}
                  title={t("deleteQueueItem")}
                  disabled={pendingPaths.has(node.path) || activeJobs.has(node.path) || Boolean(deletingPath) || deletingBatch}
                  onClick={() => void deleteNode(node)}
                >
                  {deletingPath === node.path ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {result ? <div className="maintenance-result"><strong>{t("maintenanceComplete")}</strong><p>{result.summary}</p>{result.lintIssues > 0 ? <span>{t("lintRemaining", { count: result.lintIssues })}</span> : null}</div> : null}
      {repairResult ? (
        <div className={repairResult.unlocked ? "maintenance-result" : "maintenance-error"}>
          <strong>{t(repairResult.unlocked ? "repairComplete" : "repairStillBlocked")}</strong>
          <p>{repairResult.summary}</p>
          {repairResult.remainingReasons.length > 0 ? <span>{repairResult.remainingReasons.map((reason) => localizedFollowupReason(reason, language)).join("；")}</span> : null}
        </div>
      ) : null}
      {error ? <div className="maintenance-error"><strong>{t(errorAction === "repair" ? "repairFailed" : "maintenanceFailed")}</strong><p>{error}</p></div> : null}
    </section>
  );
}

type QueueAgentSettings = {
  distill: AgentTaskSelection;
  repair: AgentTaskSelection;
};

function loadQueueAgentSettings(): QueueAgentSettings {
  try {
    return {
      distill: {
        provider: String(window.localStorage.getItem("my-wiki-queue-distill-provider") || "").trim().toLowerCase(),
        model: String(window.localStorage.getItem("my-wiki-queue-distill-model") || "").trim()
      },
      repair: {
        provider: String(window.localStorage.getItem("my-wiki-queue-repair-provider") || "").trim().toLowerCase(),
        model: String(window.localStorage.getItem("my-wiki-queue-repair-model") || "").trim()
      }
    };
  } catch {
    return { distill: { provider: "", model: "" }, repair: { provider: "", model: "" } };
  }
}

function normalizeQueueAgentSettings(agent: AgentInfo, settings: QueueAgentSettings): QueueAgentSettings {
  const fallback = agent.providers.find((item) => item.provider === agent.defaultProvider) || agent.providers[0];
  const normalize = (selection: AgentTaskSelection): AgentTaskSelection => {
    const provider = agent.providers.find((item) => item.provider === selection.provider) || fallback;
    const model = selection.model && provider?.models.some((item) => item.id === selection.model) ? selection.model : "";
    return { provider: provider?.provider || agent.provider, model };
  };
  const next = { distill: normalize(settings.distill), repair: normalize(settings.repair) };
  return next.distill.provider === settings.distill.provider
    && next.distill.model === settings.distill.model
    && next.repair.provider === settings.repair.provider
    && next.repair.model === settings.repair.model
    ? settings
    : next;
}

function persistQueueAgentSettings(settings: QueueAgentSettings) {
  try {
    window.localStorage.setItem("my-wiki-queue-distill-provider", settings.distill.provider);
    window.localStorage.setItem("my-wiki-queue-distill-model", settings.distill.model);
    window.localStorage.setItem("my-wiki-queue-repair-provider", settings.repair.provider);
    window.localStorage.setItem("my-wiki-queue-repair-model", settings.repair.model);
  } catch {
    // Queue settings remain available for this browser session.
  }
}

function rawJobPath(job: Job) {
  return String(job.meta.path || (Array.isArray(job.meta.paths) ? job.meta.paths[0] : "") || "");
}

function rawTaskLabel(job: Job | undefined, language: "en" | "zh") {
  if (!job) return "";
  if (job.status === "queued") return language === "zh" ? "等待执行" : "Queued";
  if (job.meta.action === "repair") return language === "zh" ? "正在修复" : "Repairing";
  return language === "zh" ? "正在蒸馏" : "Distilling";
}

function QueueProgress({ progress, language }: { progress: TaskProgress; language: "en" | "zh" }) {
  const percent = progress.percent;
  const phaseLabels: Record<string, [string, string]> = {
    "preserving-snapshot": ["保存原始快照", "Preserving original snapshot"],
    extracting: ["准备提取", "Preparing extraction"],
    analyzing: ["分析文档结构", "Analyzing document structure"],
    "pdf-analysis": ["读取 PDF 结构", "Reading PDF structure"],
    "visual-analysis": ["检查空白页与透印", "Checking page artifacts"],
    mineru: ["MinerU 提取", "MinerU extraction"],
    "agent-vision-repair": ["多模态页面修复", "Multimodal page repair"],
    ocr: ["OCR 文字识别", "OCR text recognition"],
    "quality-check": ["检查页面与公式", "Checking pages and formulas"],
    assembling: ["整理 Markdown 与图片", "Assembling Markdown and images"],
    "writing-raw": ["写入参考资料", "Writing reference evidence"],
    complete: ["提取完成", "Extraction complete"]
  };
  const label = phaseLabels[progress.phase]?.[language === "zh" ? 0 : 1] || (language === "zh" ? "正在提取" : "Extracting");
  const detail = progress.total > 0 && progress.current > 0 ? `${label} · ${progress.current}/${progress.total}` : label;
  return (
    <div className="task-progress" role="progressbar" aria-label={detail} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
      <div className="task-progress-label"><span>{detail}</span>{percent !== null ? <strong>{percent}%</strong> : null}</div>
      <div className={`task-progress-track${percent === null ? " is-indeterminate" : ""}`}><span style={percent === null ? undefined : { width: `${percent}%` }} /></div>
    </div>
  );
}

function buildUniverseSummary(graph: WikiGraph, group: string) {
  const wikiNodes = graph.nodes.filter((node) => node.id.startsWith("concepts/") && nodeUniverses(node).includes(group));
  const wikiIds = new Set(wikiNodes.map((node) => node.id));
  const evidenceIds = new Set<string>();
  const tagCounts = new Map<string, number>();

  for (const node of wikiNodes) {
    for (const tag of node.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }

  for (const edge of graph.edges) {
    if (wikiIds.has(edge.source) && edge.target.startsWith("references/sources/")) evidenceIds.add(edge.target);
    if (wikiIds.has(edge.target) && edge.source.startsWith("references/sources/")) evidenceIds.add(edge.source);
  }

  const topPages = [...wikiNodes]
    .sort((a, b) => (b.out.length + b.backlinks.length) - (a.out.length + a.backlinks.length))
    .slice(0, 10);
  const topTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12);

  return {
    wikiNodes,
    evidenceCount: evidenceIds.size,
    topPages,
    topTags,
    tagCount: tagCounts.size
  };
}

type SimNode = LayoutNode & {
  vx: number;
  vy: number;
};

type UniverseConnection = {
  weight: number;
  sharedMembership: boolean;
};

function buildLayout(
  nodes: WikiNode[],
  edges: WikiEdge[],
  scope: GraphScope,
  selectedId: string | null,
  rotation: { x: number; y: number },
  isUniverseOverview: boolean
): LayoutNode[] {
  const width = viewBox.width;
  const height = viewBox.height;
  const isLocal = scope === "local";
  const degree = new Map(nodes.map((node) => [node.id, node.out.length + node.backlinks.length]));
  if (!isLocal && nodes.every((node) => node.id.startsWith("concepts/"))) {
    return buildWikiUniverseLayout(nodes, edges, degree, rotation, isUniverseOverview);
  }
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
        a.id.startsWith("concepts/") && b.id.startsWith("concepts/") ? 92 :
        a.id.startsWith("references/sources/") && b.id.startsWith("references/sources/") ? 82 :
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
        node.id.startsWith("concepts/") ? 0.028 :
        node.id.startsWith("references/sources/") ? 0.038 :
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

function buildWikiUniverseLayout(
  nodes: WikiNode[],
  edges: WikiEdge[],
  degree: Map<string, number>,
  rotation: { x: number; y: number },
  isUniverseOverview: boolean
): LayoutNode[] {
  const groupBuckets = new Map<string, WikiNode[]>();
  for (const node of nodes) {
    const group = primaryUniverse(node);
    groupBuckets.set(group, [...(groupBuckets.get(group) ?? []), node]);
  }

  const groupSizes = Object.fromEntries(Array.from(groupBuckets, ([group, bucket]) => [group, bucket.length]));
  const universeConnections = buildWikiUniverseConnections(nodes, edges);
  const connectionList = Array.from(universeConnections, ([key, connection]) => {
    const [source, target] = key.split("\u0000");
    return { source, target, weight: connection.weight };
  });
  const groups = rankUniverseGroupsByConnectivity(Array.from(groupBuckets.keys()), connectionList, groupSizes);
  const isOverview = shouldUseDegreeCenteredUniverseLayout({ isUniverseOverview, groupCount: groups.length });
  const overviewRadius = overviewUniverseRadius(groups.length);
  const overviewRadii = new Map(groups.map((group) => [group, overviewRadius]));
  const centers = wikiSphereCenters(groups, overviewRadii, universeConnections);

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

function wikiSphereCenters(
  groups: string[],
  universeRadii: Map<string, number>,
  universeConnections: Map<string, UniverseConnection>
) {
  const centers = new Map<string, { x: number; y: number }>();
  if (groups.length === 0) return centers;
  if (groups.length === 1) {
    centers.set(groups[0], { x: viewBox.width / 2, y: viewBox.height / 2 });
    return centers;
  }

  const maxRadius = Math.max(...groups.map((group) => universeRadii.get(group) ?? overviewUniverseRadius(groups.length)));
  const shellRadius = overviewUniverseShellRadius(maxRadius);
  const minimumStep = shellRadius * 2 + 18;
  const peripheralCount = groups.length - 1;
  const clusterRadius = peripheralCount <= 2
    ? minimumStep
    : Math.max(minimumStep, minimumStep / (2 * Math.sin(Math.PI / peripheralCount)));
  const center = { x: viewBox.width / 2, y: viewBox.height / 2 };
  groups.forEach((group, index) => {
    if (index === 0) {
      centers.set(group, center);
      return;
    }
    const angle = peripheralCount === 1
      ? 0
      : peripheralCount === 2
        ? (index === 1 ? -0.28 : Math.PI + 0.42)
        : -Math.PI / 2 + ((index - 1) / peripheralCount) * Math.PI * 2;
    centers.set(group, {
      x: center.x + Math.cos(angle) * clusterRadius,
      y: center.y + Math.sin(angle) * clusterRadius
    });
  });
  return settleUniverseCenters(groups, centers, universeRadii, universeConnections);
}

function settleUniverseCenters(
  groups: string[],
  initialCenters: Map<string, { x: number; y: number }>,
  universeRadii: Map<string, number>,
  universeConnections: Map<string, UniverseConnection>
) {
  const centers = new Map(groups.map((group) => {
    const center = initialCenters.get(group) ?? { x: viewBox.width / 2, y: viewBox.height / 2 };
    return [group, { ...center, vx: 0, vy: 0 }];
  }));
  const attractionCenter = { x: viewBox.width / 2, y: viewBox.height / 2 };
  const centralGroup = groups[0];

  for (let tick = 0; tick < 260; tick += 1) {
    const alpha = 1 - tick / 260;
    for (const group of groups) {
      const center = centers.get(group);
      if (!center) continue;
      const centerPull = group === centralGroup ? 0.075 : 0.0012;
      center.vx += (attractionCenter.x - center.x) * centerPull * alpha;
      center.vy += (attractionCenter.y - center.y) * centerPull * alpha;
    }

    for (let i = 0; i < groups.length; i += 1) {
      for (let j = i + 1; j < groups.length; j += 1) {
        const a = centers.get(groups[i]);
        const b = centers.get(groups[j]);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.max(Math.hypot(dx, dy), 0.001);
        const connection = universeConnections.get(universePairKey(groups[i], groups[j]));
        const shared = Boolean(connection?.sharedMembership);
        const aRadius = universeRadii.get(groups[i]) ?? overviewUniverseRadius(groups.length);
        const bRadius = universeRadii.get(groups[j]) ?? overviewUniverseRadius(groups.length);
        const noOverlapDistance = overviewUniverseShellRadius(aRadius) + overviewUniverseShellRadius(bRadius) + 18;
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
        } else if (connection) {
          const connectionScale = 1 + Math.log1p(connection.weight) * 0.24;
          const pull = (distance - targetDistance) * (shared ? 0.0022 : 0.00115) * connectionScale * alpha;
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

function buildWikiUniverseConnections(nodes: WikiNode[], edges: WikiEdge[]) {
  const connections = new Map<string, UniverseConnection>();
  const addConnection = (a: string, b: string, weight: number, sharedMembership = false) => {
    if (!a || !b || a === b) return;
    const key = universePairKey(a, b);
    const current = connections.get(key) ?? { weight: 0, sharedMembership: false };
    connections.set(key, {
      weight: current.weight + weight,
      sharedMembership: current.sharedMembership || sharedMembership
    });
  };

  for (const node of nodes) {
    if (!node.id.startsWith("concepts/")) continue;
    const universes = nodeUniverses(node);
    for (let i = 0; i < universes.length; i += 1) {
      for (let j = i + 1; j < universes.length; j += 1) {
        addConnection(universes[i], universes[j], 2, true);
      }
    }
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const edge of edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source?.id.startsWith("concepts/") || !target?.id.startsWith("concepts/")) continue;
    for (const sourceUniverse of nodeUniverses(source)) {
      for (const targetUniverse of nodeUniverses(target)) {
        addConnection(sourceUniverse, targetUniverse, 1);
      }
    }
  }
  return connections;
}

function universePairKey(a: string, b: string) {
  return [a, b].sort((left, right) => left.localeCompare(right)).join("\u0000");
}

function overviewUniverseRadius(groupCount: number) {
  if (groupCount <= 1) return 232;
  if (groupCount === 2) return 170;
  if (groupCount === 3) return 132;
  if (groupCount === 4) return 96;
  if (groupCount <= 6) return 82;
  if (groupCount <= 9) return 68;
  return clamp(68 - (groupCount - 9) * 2, 52, 68);
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
    if (edge.source === wikiId && edge.target.startsWith("references/sources/")) ids.add(edge.target);
    if (edge.target === wikiId && edge.source.startsWith("references/sources/")) ids.add(edge.source);
  }
  return ids;
}

function pickLocalCenter(nodes: WikiNode[]) {
  const knowledgeCandidates = nodes.filter((node) => node.id.startsWith("concepts/") && isDefaultLocalCandidate(node));
  if (knowledgeCandidates.length > 0) {
    return [...knowledgeCandidates].sort((a, b) => nodeDegree(b) - nodeDegree(a) || a.title.localeCompare(b.title))[0] ?? null;
  }
  const candidates = nodes.some((node) => node.id.startsWith("concepts/"))
    ? nodes.filter((node) => node.id.startsWith("concepts/"))
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
  if (node.id.startsWith("references/sources/")) return Math.min(5.4, 2.2 + Math.sqrt(Math.max(node.degree, 1)) * 0.62);
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
  if (node.id.startsWith("references/sources/")) return colorForGroup(group);
  if (node.id.startsWith("concepts/")) return colorForDegree(nodeDegree(node));
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
        count: nodes.filter((node) => node.type !== "declared-universe").length,
        color: colorForGroup(group),
        radius
      };
    })
    .sort((a, b) => b.count - a.count || a.group.localeCompare(b.group))
    .slice(0, 16);
}

function declaredUniversePlaceholder(universe: string): WikiNode {
  return {
    id: `concepts/__declared_universe__/${stableHash(universe)}`,
    path: "",
    title: universe,
    type: "declared-universe",
    group: `Wiki / ${universe}`,
    universes: [universe],
    status: "declared",
    tags: [],
    out: [],
    backlinks: []
  };
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

function galaxyKey(value: string) {
  return value.replace(/^Wiki\s*\/\s*/i, "").trim().toLocaleLowerCase();
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
  if (node.id.startsWith("references/sources/autodesk-flexsim-2026/")) return "FlexSim / Corpus";
  if (node.id.startsWith("references/sources/")) return "Raw / Other";
  if (node.id.startsWith("concepts/")) return inferWikiGroup(node.title, node.tags);
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
