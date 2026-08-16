export type MarkdownOutlineItem = {
  level: number;
  text: string;
  id: string;
  offset: number;
};

export function markdownHeadingId(value: string) {
  const text = plainMarkdownHeading(value);
  const slug = text
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/[\s_-]+/g, "-");
  return slug || "section";
}

export function markdownOutline(content: string): MarkdownOutlineItem[] {
  const items: MarkdownOutlineItem[] = [];
  const occurrences = new Map<string, number>();
  const pattern = /^(#{1,4})\s+(.+?)\s*#*\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content))) {
    const text = plainMarkdownHeading(match[2]);
    const base = markdownHeadingId(text);
    const occurrence = occurrences.get(base) || 0;
    occurrences.set(base, occurrence + 1);
    items.push({
      level: match[1].length,
      text,
      id: occurrence ? `${base}-${occurrence + 1}` : base,
      offset: match.index
    });
  }
  return items;
}

export function markdownDocumentStats(content: string) {
  const normalized = content.trim();
  const words = normalized
    ? (normalized.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).length
    : 0;
  return {
    characters: [...content].length,
    words,
    lines: content ? content.split(/\r?\n/).length : 0
  };
}

function plainMarkdownHeading(value: string) {
  return String(value)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`]/g, "")
    .trim();
}
