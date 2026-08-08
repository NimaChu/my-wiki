import type { AgentAnswer } from "./api";

export function promoteVaultMarkdownImages(
  content: string,
  suppliedImages?: AgentAnswer["images"]
): { content: string; images: AgentAnswer["images"] };
