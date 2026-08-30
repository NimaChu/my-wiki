export function isUniverseOverviewMode({ graphMode, graphScope, focusedGroup }) {
  return graphMode === "knowledge" && graphScope === "global" && !focusedGroup;
}

export function shouldUseDegreeCenteredUniverseLayout({ isUniverseOverview, groupCount }) {
  return isUniverseOverview && groupCount > 0;
}

export function missingDeclaredUniverseNames(declaredUniverses, representedUniverses) {
  const represented = new Set(representedUniverses.map(normalizeGalaxyKey).filter(Boolean));
  return declaredUniverses.filter((universe) => !represented.has(normalizeGalaxyKey(universe)));
}

export function centeredPairAxis(center, distance, firstRadius, secondRadius) {
  return [
    center - (distance + secondRadius - firstRadius) / 2,
    center + (distance + firstRadius - secondRadius) / 2
  ];
}

export function rankUniverseGroupsByConnectivity(groups, connections, groupSizes = {}) {
  const originalIndex = new Map(groups.map((group, index) => [group, index]));
  const stats = new Map(groups.map((group) => [group, { neighbors: new Set(), strength: 0 }]));
  for (const connection of connections) {
    const source = String(connection?.source || "");
    const target = String(connection?.target || "");
    if (!stats.has(source) || !stats.has(target) || source === target) continue;
    const weight = Math.max(1, Number(connection?.weight) || 1);
    stats.get(source).neighbors.add(target);
    stats.get(target).neighbors.add(source);
    stats.get(source).strength += weight;
    stats.get(target).strength += weight;
  }

  return [...groups].sort((a, b) => {
    const aStats = stats.get(a);
    const bStats = stats.get(b);
    return (bStats?.neighbors.size ?? 0) - (aStats?.neighbors.size ?? 0)
      || (bStats?.strength ?? 0) - (aStats?.strength ?? 0)
      || (Number(groupSizes[b]) || 0) - (Number(groupSizes[a]) || 0)
      || (originalIndex.get(a) ?? 0) - (originalIndex.get(b) ?? 0)
      || a.localeCompare(b);
  });
}

function normalizeGalaxyKey(value) {
  return String(value || "").replace(/^Wiki\s*\/\s*/i, "").trim().toLocaleLowerCase();
}
