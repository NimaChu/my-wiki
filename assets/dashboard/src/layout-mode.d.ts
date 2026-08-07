export function isUniverseOverviewMode(state: {
  graphMode: "knowledge" | "evidence";
  graphScope: "global" | "local";
  focusedGroup: string | null;
}): boolean;

export function shouldUseDegreeCenteredUniverseLayout(state: {
  isUniverseOverview: boolean;
  groupCount: number;
}): boolean;
