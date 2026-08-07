export function isUniverseOverviewMode({ graphMode, graphScope, focusedGroup }) {
  return graphMode === "knowledge" && graphScope === "global" && !focusedGroup;
}

export function shouldUseDegreeCenteredUniverseLayout({ isUniverseOverview, groupCount }) {
  return isUniverseOverview && groupCount > 0;
}
