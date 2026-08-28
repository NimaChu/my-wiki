export type GalaxyOverviewStats = {
  wikiPages: number;
  rawSources: number;
  unresolved: number;
  inbox: number;
  processed: number;
};

export function visibleGalaxyStats(graph: {
  hiddenUniverses?: string[];
  nodes: Array<{
    id: string;
    group?: string;
    universes?: string[];
    status: string;
  }>;
  edges: Array<{ source: string; target: string }>;
  unresolved: Array<{ source: string; target: string }>;
}): GalaxyOverviewStats;
