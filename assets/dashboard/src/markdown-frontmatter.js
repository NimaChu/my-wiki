export function splitMarkdownFrontmatter(content) {
  const match = String(content).match(/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/);
  if (!match) return { prefix: "", body: String(content) };
  return { prefix: match[0], body: String(content).slice(match[0].length) };
}

export function joinMarkdownFrontmatter(prefix, body) {
  return `${prefix}${body}`;
}
