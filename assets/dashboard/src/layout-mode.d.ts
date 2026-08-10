export function isUniverseOverviewMode(state: {
  graphMode: "knowledge" | "evidence";
  graphScope: "global" | "local";
  focusedGroup: string | null;
}): boolean;

export function shouldUseDegreeCenteredUniverseLayout(state: {
  isUniverseOverview: boolean;
  groupCount: number;
}): boolean;

export function rankUniverseGroupsByConnectivity(
  groups: string[],
  connections: Array<{ source: string; target: string; weight?: number }>,
  groupSizes?: Record<string, number>
): string[];
