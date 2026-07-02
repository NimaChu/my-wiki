import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type WikiNode = {
  id: string;
  path: string;
  title: string;
  type: string;
  status: string;
  tags: string[];
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
  section: string;
  type: string;
  status: string;
  links: "all" | "wiki";
};

type LayoutNode = WikiNode & {
  x: number;
  y: number;
  degree: number;
};

const viewBox = { width: 1280, height: 760 };

const typeColors: Record<string, string> = {
  "raw-source": "#68a6a1",
  topic: "#d29a54",
  concept: "#8da2ff",
  product: "#77b56b",
  company: "#d87c70",
  person: "#c486d7",
  method: "#d5c266",
  comparison: "#82b8df",
  index: "#aeb7bd",
  log: "#8d979f",
  archive: "#697179",
  wiki: "#8da2ff",
  note: "#aeb7bd"
};

const initialFilters: Filters = {
  query: "",
  section: "all",
  type: "all",
  status: "all",
  links: "all"
};

function App() {
  const [graph, setGraph] = useState<WikiGraph | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showLabels, setShowLabels] = useState(false);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    fetch("/wiki-graph.json", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data: WikiGraph) => {
        setGraph(data);
        setSelectedId(data.nodes.find((node) => node.id === "wiki/index")?.id ?? data.nodes[0]?.id ?? null);
      })
      .catch((error: Error) => setLoadError(error.message));
  }, []);

  const nodeById = useMemo(() => new Map((graph?.nodes ?? []).map((node) => [node.id, node])), [graph]);
  const filterOptions = useMemo(() => {
    const nodes = graph?.nodes ?? [];
    return {
      sections: unique(nodes.map((node) => node.id.split("/")[0])),
      types: unique(nodes.map((node) => node.type)),
      statuses: unique(nodes.map((node) => node.status))
    };
  }, [graph]);

  const filteredNodes = useMemo(() => {
    if (!graph) return [];
    const needle = filters.query.trim().toLowerCase();
    return graph.nodes.filter((node) => {
      const section = node.id.split("/")[0];
      const searchable = [node.title, node.path, node.type, node.status, ...node.tags].join(" ").toLowerCase();
      return (
        (filters.section === "all" || filters.section === section) &&
        (filters.type === "all" || filters.type === node.type) &&
        (filters.status === "all" || filters.status === node.status) &&
        (filters.links === "all" || node.id.startsWith("wiki/")) &&
        (needle === "" || searchable.includes(needle))
      );
    });
  }, [graph, filters]);

  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map((node) => node.id)), [filteredNodes]);
  const filteredEdges = useMemo(() => {
    if (!graph) return [];
    return graph.edges.filter((edge) => filteredNodeIds.has(edge.source) && filteredNodeIds.has(edge.target));
  }, [graph, filteredNodeIds]);

  const layout = useMemo(() => buildLayout(filteredNodes, filteredEdges), [filteredNodes, filteredEdges]);
  const layoutById = useMemo(() => new Map(layout.map((node) => [node.id, node])), [layout]);
  const selected = selectedId ? nodeById.get(selectedId) ?? null : null;
  const selectedLayout = selectedId ? layoutById.get(selectedId) : null;
  const highlighted = useMemo(() => {
    if (!selectedId || !graph) return new Set<string>();
    const ids = new Set([selectedId]);
    for (const edge of graph.edges) {
      if (edge.source === selectedId) ids.add(edge.target);
      if (edge.target === selectedId) ids.add(edge.source);
    }
    return ids;
  }, [graph, selectedId]);

  if (loadError) {
    return (
      <main className="empty-state">
        <h1>Graph unavailable</h1>
        <p>{loadError}</p>
      </main>
    );
  }

  if (!graph) {
    return (
      <main className="empty-state">
        <h1>Loading graph</h1>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="left-panel">
        <header className="brand">
          <div className="brand-mark">K</div>
          <div>
            <h1>Knowledge Graph</h1>
            <p>Markdown vault, Obsidian-compatible</p>
          </div>
        </header>

        <label className="control">
          <span>Search</span>
          <input value={filters.query} onChange={(event) => setFilters({ ...filters, query: event.target.value })} placeholder="page, tag, path" />
        </label>

        <FilterSelect label="Section" value={filters.section} options={filterOptions.sections} onChange={(section) => setFilters({ ...filters, section })} />
        <FilterSelect label="Type" value={filters.type} options={filterOptions.types} onChange={(type) => setFilters({ ...filters, type })} />
        <FilterSelect label="Status" value={filters.status} options={filterOptions.statuses} onChange={(status) => setFilters({ ...filters, status })} />

        <div className="segmented">
          <button className={filters.links === "all" ? "is-active" : ""} onClick={() => setFilters({ ...filters, links: "all" })}>All</button>
          <button className={filters.links === "wiki" ? "is-active" : ""} onClick={() => setFilters({ ...filters, links: "wiki" })}>Wiki only</button>
        </div>

        <div className="toolbar-row">
          <button onClick={() => setShowLabels((value) => !value)}>{showLabels ? "Hide labels" : "Show labels"}</button>
          <button onClick={() => setFilters(initialFilters)}>Reset</button>
        </div>

        <div className="zoom-row">
          <span>Zoom</span>
          <input type="range" min="0.7" max="1.8" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
        </div>

        <Stats graph={graph} visibleNodes={filteredNodes.length} visibleEdges={filteredEdges.length} />
        <QueueSummary graph={graph} nodeById={nodeById} onSelect={setSelectedId} />
      </aside>

      <section className="graph-stage">
        <GraphView
          layout={layout}
          layoutById={layoutById}
          edges={filteredEdges}
          selectedId={selectedId}
          selectedLayout={selectedLayout}
          highlighted={highlighted}
          showLabels={showLabels}
          zoom={zoom}
          onSelect={setSelectedId}
        />
      </section>

      <aside className="right-panel">
        <NodeInspector node={selected} graph={graph} nodeById={nodeById} onSelect={setSelectedId} />
      </aside>
    </main>
  );
}

function GraphView({
  layout,
  layoutById,
  edges,
  selectedId,
  selectedLayout,
  highlighted,
  showLabels,
  zoom,
  onSelect
}: {
  layout: LayoutNode[];
  layoutById: Map<string, LayoutNode>;
  edges: WikiEdge[];
  selectedId: string | null;
  selectedLayout?: LayoutNode | null;
  highlighted: Set<string>;
  showLabels: boolean;
  zoom: number;
  onSelect: (id: string) => void;
}) {
  const scale = 1 / zoom;
  const centerX = selectedLayout?.x ?? viewBox.width / 2;
  const centerY = selectedLayout?.y ?? viewBox.height / 2;
  const boxWidth = viewBox.width * scale;
  const boxHeight = viewBox.height * scale;
  const computedViewBox = `${centerX - boxWidth / 2} ${centerY - boxHeight / 2} ${boxWidth} ${boxHeight}`;

  return (
    <svg className="graph-svg" viewBox={computedViewBox} role="img" aria-label="Knowledge graph">
      <defs>
        <radialGradient id="nodeGlow">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.78" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g className="edge-layer">
        {edges.map((edge) => {
          const source = layoutById.get(edge.source);
          const target = layoutById.get(edge.target);
          if (!source || !target) return null;
          const isHot = selectedId ? edge.source === selectedId || edge.target === selectedId : false;
          return (
            <line
              key={`${edge.source}-${edge.target}`}
              className={`graph-edge ${isHot ? "is-hot" : ""}`}
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
            />
          );
        })}
      </g>
      <g className="node-layer">
        {layout.map((node) => {
          const isSelected = node.id === selectedId;
          const isDim = selectedId ? !highlighted.has(node.id) : false;
          const radius = nodeRadius(node);
          return (
            <g
              key={node.id}
              className={`graph-node ${isSelected ? "is-selected" : ""} ${isDim ? "is-dim" : ""}`}
              transform={`translate(${node.x}, ${node.y})`}
              onClick={() => onSelect(node.id)}
            >
              <circle className="node-halo" r={radius + 12} />
              <circle className="node-dot" r={radius} fill={typeColors[node.type] ?? typeColors.note} />
          {(showLabels || isSelected || highlighted.has(node.id)) && (
            <text y={radius + 18}>
              {node.title.length > 26 ? `${node.title.slice(0, 24)}...` : node.title}
            </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

function NodeInspector({
  node,
  graph,
  nodeById,
  onSelect
}: {
  node: WikiNode | null;
  graph: WikiGraph;
  nodeById: Map<string, WikiNode>;
  onSelect: (id: string) => void;
}) {
  if (!node) {
    return (
      <section className="inspector">
        <p className="muted">Select a node</p>
      </section>
    );
  }

  const neighbors = unique([...node.out, ...node.backlinks])
    .map((id) => nodeById.get(id))
    .filter(Boolean) as WikiNode[];
  const broken = graph.unresolved.filter((item) => item.source === node.id);
  const issues = graph.processedIssues.filter((item) => item.source === node.id);

  return (
    <section className="inspector">
      <div className="node-title">
        <span className="type-chip" style={{ backgroundColor: typeColors[node.type] ?? typeColors.note }}>{node.type}</span>
        <h2>{node.title}</h2>
        <p>{node.path}</p>
      </div>

      <dl className="node-metrics">
        <div><dt>Status</dt><dd>{node.status}</dd></div>
        <div><dt>Links</dt><dd>{node.out.length}</dd></div>
        <div><dt>Backlinks</dt><dd>{node.backlinks.length}</dd></div>
        <div><dt>Degree</dt><dd>{node.out.length + node.backlinks.length}</dd></div>
      </dl>

      <section className="tag-list">
        {node.tags.map((tag) => <span key={tag}>#{tag}</span>)}
      </section>

      {(broken.length > 0 || issues.length > 0) && (
        <section className="warning-box">
          <h3>Attention</h3>
          {broken.map((item) => <p key={item.target}>Broken: {item.target}</p>)}
          {issues.map((item) => <p key={item.reason}>Gate: {item.reason}</p>)}
        </section>
      )}

      <section className="neighbor-list">
        <h3>Connected Pages</h3>
        {neighbors.length === 0 ? (
          <p className="muted">No connected pages</p>
        ) : (
          neighbors.slice(0, 18).map((neighbor) => (
            <button key={neighbor.id} onClick={() => onSelect(neighbor.id)}>
              <strong>{neighbor.title}</strong>
              <span>{neighbor.type} / {neighbor.status}</span>
            </button>
          ))
        )}
      </section>
    </section>
  );
}

function Stats({ graph, visibleNodes, visibleEdges }: { graph: WikiGraph; visibleNodes: number; visibleEdges: number }) {
  const items = [
    ["Visible", visibleNodes],
    ["Links", visibleEdges],
    ["Wiki", graph.stats.wikiPages ?? 0],
    ["Raw", graph.stats.rawSources ?? 0],
    ["Inbox", graph.stats.inbox ?? 0],
    ["Broken", graph.stats.unresolved ?? 0]
  ];

  return (
    <section className="stats-grid">
      {items.map(([label, value]) => (
        <div key={label} className="stat-card">
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </section>
  );
}

function QueueSummary({ graph, nodeById, onSelect }: { graph: WikiGraph; nodeById: Map<string, WikiNode>; onSelect: (id: string) => void }) {
  const ids = [...graph.queues.inbox, ...graph.queues.needsFollowup, ...graph.queues.stale].slice(0, 8);
  const nodes = ids.map((id) => nodeById.get(id)).filter(Boolean) as WikiNode[];
  return (
    <section className="queue-panel">
      <h2>Maintenance Queue</h2>
      {nodes.length === 0 ? (
        <p className="muted">No inbox or follow-up items</p>
      ) : (
        nodes.map((node) => (
          <button key={node.id} onClick={() => onSelect(node.id)}>
            <strong>{node.title}</strong>
            <span>{node.status}</span>
          </button>
        ))
      )}
    </section>
  );
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="control">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="all">All</option>
        {options.map((option) => (
          <option value={option} key={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

type SimNode = LayoutNode & {
  vx: number;
  vy: number;
};

function buildLayout(nodes: WikiNode[], edges: WikiEdge[]): LayoutNode[] {
  const width = viewBox.width;
  const height = viewBox.height;
  const degree = new Map(nodes.map((node) => [node.id, node.out.length + node.backlinks.length]));
  const points: SimNode[] = nodes.map((node, index) => {
    const angle = index * 2.399963229728653;
    const section = node.id.split("/")[0];
    const radius =
      section === "wiki" ? 80 + Math.sqrt(index + 1) * 18 :
      section === "raw" ? 190 + Math.sqrt(index + 1) * 20 :
      260 + Math.sqrt(index + 1) * 12;
    const target = clusterTarget(node);
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

  for (let tick = 0; tick < 260; tick += 1) {
    const alpha = 1 - tick / 260;
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const a = points[i];
        const b = points[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist2 = Math.max(dx * dx + dy * dy, 80);
        const force = (260 * alpha) / dist2;
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
      const target = a.id.startsWith("wiki/") && b.id.startsWith("wiki/") ? 92 : 150;
      const force = (distance - target) * 0.012 * alpha;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    for (const node of points) {
      const target = clusterTarget(node);
      const centerPull = node.id.startsWith("wiki/") ? 0.026 : 0.016;
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

function clusterTarget(node: WikiNode) {
  const section = node.id.split("/")[0];
  if (section === "wiki") return { x: viewBox.width * 0.52, y: viewBox.height * 0.48 };
  if (section === "raw") return { x: viewBox.width * 0.48, y: viewBox.height * 0.5 };
  if (section === "templates") return { x: viewBox.width * 0.63, y: viewBox.height * 0.62 };
  if (section === "_archive") return { x: viewBox.width * 0.33, y: viewBox.height * 0.36 };
  return { x: viewBox.width / 2, y: viewBox.height / 2 };
}

function nodeRadius(node: LayoutNode) {
  return Math.min(19, 6 + Math.sqrt(Math.max(node.degree, 1)) * 2.1);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

createRoot(document.getElementById("root")!).render(<App />);
