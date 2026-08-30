export function isUniverseOverviewMode(state: {
  graphMode: "knowledge" | "evidence";
  graphScope: "global" | "local";
  focusedGroup: string | null;
}): boolean;

export function shouldUseDegreeCenteredUniverseLayout(state: {
  isUniverseOverview: boolean;
  groupCount: number;
}): boolean;

export function missingDeclaredUniverseNames(
  declaredUniverses: string[],
  representedUniverses: string[]
): string[];

export function centeredPairAxis(
  center: number,
  distance: number,
  firstRadius: number,
  secondRadius: number
): [number, number];

export function rankUniverseGroupsByConnectivity(
  groups: string[],
  connections: Array<{ source: string; target: string; weight?: number }>,
  groupSizes?: Record<string, number>
): string[];
