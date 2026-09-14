import type { AgentProvider } from "./api";
export function vikiModelSelection(provider?: AgentProvider, savedModel?: string): {
  selected: string;
  models: AgentProvider["models"];
  label: string;
};
