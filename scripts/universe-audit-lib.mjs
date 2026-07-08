const WIKI_UTILITY_IDS = new Set(["wiki/index", "wiki/log", "wiki/README"]);

export function wikiKnowledgeNodes(scan) {
  return scan.nodes.filter((node) => node.id.startsWith("wiki/") && !WIKI_UTILITY_IDS.has(node.id));
}

export function universeAudit(scan) {
  const wikiNodes = wikiKnowledgeNodes(scan);
  const byId = new Map(scan.nodes.map((node) => [node.id, node]));
  const groups = new Map();
  for (const node of wikiNodes) {
    const group = String(node.frontmatter.group || "Unknown");
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(node);
  }

  const summaries = [...groups.entries()]
    .map(([group, nodes]) => {
      const tagCounts = new Map();
      const types = new Map();
      const rawEvidence = new Set();
      const relatedGroups = new Map();

      for (const node of nodes) {
        types.set(node.type, (types.get(node.type) ?? 0) + 1);
        for (const tag of node.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
        for (const link of node.links) {
          const targetId = scan.resolve(link);
          if (!targetId) continue;
          if (targetId.startsWith("raw/")) rawEvidence.add(targetId);
          const target = byId.get(targetId);
          if (target?.id.startsWith("wiki/") && !WIKI_UTILITY_IDS.has(target.id)) {
            const targetGroup = String(target.frontmatter.group || "Unknown");
            if (targetGroup !== group) relatedGroups.set(targetGroup, (relatedGroups.get(targetGroup) ?? 0) + 1);
          }
        }
      }

      const topTags = [...tagCounts.entries()].sort(sortCountThenName).slice(0, 8);
      const topTypes = [...types.entries()].sort(sortCountThenName);
      const topPages = [...nodes]
        .sort((a, b) => (b.links.length + (scan.incoming.get(b.id) ?? 0)) - (a.links.length + (scan.incoming.get(a.id) ?? 0)) || a.title.localeCompare(b.title))
        .slice(0, 8)
        .map((node) => node.title);

      return {
        group,
        wikiPages: nodes.length,
        rawEvidence: rawEvidence.size,
        topTags,
        topTypes,
        topPages,
        relatedGroups: [...relatedGroups.entries()].sort(sortCountThenName).slice(0, 6)
      };
    })
    .sort((a, b) => b.wikiPages - a.wikiPages || a.group.localeCompare(b.group));

  const crossGroupPairs = crossGroupWikiPairs(scan, byId);
  const suggestions = buildUniverseSuggestions(summaries, crossGroupPairs);
  return { summaries, crossGroupPairs, suggestions };
}

function crossGroupWikiPairs(scan, byId) {
  const pairCounts = new Map();
  for (const edge of scan.edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source?.id.startsWith("wiki/") || !target?.id.startsWith("wiki/")) continue;
    if (WIKI_UTILITY_IDS.has(source.id) || WIKI_UTILITY_IDS.has(target.id)) continue;
    const sourceGroup = String(source.frontmatter.group || "Unknown");
    const targetGroup = String(target.frontmatter.group || "Unknown");
    if (sourceGroup === targetGroup) continue;
    const key = [sourceGroup, targetGroup].sort((a, b) => a.localeCompare(b)).join(" -> ");
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  }
  return [...pairCounts.entries()]
    .map(([pair, count]) => ({ pair, count }))
    .sort((a, b) => b.count - a.count || a.pair.localeCompare(b.pair));
}

function buildUniverseSuggestions(summaries, crossGroupPairs) {
  const suggestions = [];
  for (const summary of summaries) {
    if (summary.group === "Unknown") {
      suggestions.push({
        kind: "assign",
        group: summary.group,
        reason: `${summary.wikiPages} wiki pages have no group; assign them to an existing or new universe.`
      });
      continue;
    }

    if (summary.wikiPages >= 50 && hasMultipleStrongTagFamilies(summary)) {
      suggestions.push({
        kind: "split-review",
        group: summary.group,
        reason: `${summary.wikiPages} wiki pages with multiple strong tag families; split only if the new universe would stay large and durable.`,
        evidence: summary.topTags.map(([tag, count]) => `${tag}:${count}`).join(", ")
      });
    }

    if (summary.wikiPages <= 2) {
      suggestions.push({
        kind: "merge-review",
        group: summary.group,
        reason: `${summary.wikiPages} wiki page(s); review whether this universe is too thin.`
      });
    }
  }

  for (const pair of crossGroupPairs.filter((item) => item.count >= 8).slice(0, 6)) {
    suggestions.push({
      kind: "merge-candidate",
      group: pair.pair,
      reason: `${pair.count} cross-universe wiki links; prefer merging or renaming boundaries unless the distinction is essential.`
    });
  }

  for (const pair of crossGroupPairs.filter((item) => item.count >= 4 && item.count < 8).slice(0, 6)) {
    suggestions.push({
      kind: "boundary-review",
      group: pair.pair,
      reason: `${pair.count} cross-universe wiki links; review whether a lighter boundary note is enough before creating or splitting universes.`
    });
  }

  return suggestions;
}

function hasMultipleStrongTagFamilies(summary) {
  const strongTags = summary.topTags.filter(([, count]) => count >= 4);
  return strongTags.length >= 3;
}

function sortCountThenName(a, b) {
  return b[1] - a[1] || a[0].localeCompare(b[0]);
}
