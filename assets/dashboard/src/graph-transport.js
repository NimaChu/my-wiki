export function packDashboardGraph(graph) {
  const index = new Map(graph.nodes.map((node, i) => [node.id, i]));
  return {
    ...graph,
    transport: "indexed-v1",
    nodes: graph.nodes.map(({ content, links, out, backlinks, ...node }) => node),
    edges: graph.edges.map(({ source, target, kind }) => [index.get(source), index.get(target), kind])
  };
}

export function unpackDashboardGraph(graph) {
  if (graph.transport !== "indexed-v1") return graph;
  const nodes = graph.nodes.map((node) => ({ ...node, out: [], backlinks: [] }));
  const edges = graph.edges.map(([source, target, kind]) => {
    if (!nodes[source] || !nodes[target]) throw new Error("Invalid knowledge graph edge");
    nodes[source].out.push(nodes[target].id);
    nodes[target].backlinks.push(nodes[source].id);
    return { source: nodes[source].id, target: nodes[target].id, kind };
  });
  const { transport, ...rest } = graph;
  return { ...rest, nodes, edges };
}
