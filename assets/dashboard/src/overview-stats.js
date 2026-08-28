function galaxyKey(value) {
  return String(value || "").replace(/^Wiki\s*\/\s*/i, "").trim().toLocaleLowerCase();
}

function nodeGalaxies(node) {
  return [...new Set([node.group, ...(node.universes || [])].filter(Boolean).map(String))];
}

export function visibleGalaxyStats(graph) {
  const hidden = new Set((graph.hiddenUniverses || []).map(galaxyKey));
  const conceptIds = new Set(graph.nodes
    .filter((node) => node.id.startsWith("concepts/"))
    .filter((node) => nodeGalaxies(node).some((name) => !hidden.has(galaxyKey(name))))
    .map((node) => node.id));
  const referenceIds = new Set();

  for (const edge of graph.edges) {
    if (conceptIds.has(edge.source) && edge.target.startsWith("references/sources/")) referenceIds.add(edge.target);
    if (conceptIds.has(edge.target) && edge.source.startsWith("references/sources/")) referenceIds.add(edge.source);
  }

  const scopedIds = new Set([...conceptIds, ...referenceIds]);
  const references = graph.nodes.filter((node) => referenceIds.has(node.id));

  return {
    wikiPages: conceptIds.size,
    rawSources: referenceIds.size,
    unresolved: graph.unresolved.filter((item) => scopedIds.has(item.source)).length,
    inbox: references.filter((node) => node.status === "inbox").length,
    processed: references.filter((node) => node.status === "processed").length
  };
}
