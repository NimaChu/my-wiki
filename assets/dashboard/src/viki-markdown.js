const IMAGE_PATH = /^references\/(assets|originals)\/.+\.(png|jpe?g|gif|webp|svg)$/i;

export function promoteVaultMarkdownImages(content, suppliedImages = []) {
  const originalBlocks = String(content || "").replace(/\r\n/g, "\n").split(/\n{2,}/).filter(Boolean);
  const outputBlocks = [];
  const blockMap = [];
  const embeddedImages = [];

  for (const block of originalBlocks) {
    const tokens = imageTokens(block);
    let cleaned = "";
    let cursor = 0;
    const accepted = [];
    for (const token of tokens) {
      if (token.index < cursor) continue;
      const path = normalizeImagePath(token.path);
      cleaned += block.slice(cursor, token.index);
      if (!path) cleaned += block.slice(token.index, token.index + token.length);
      else accepted.push({ path, caption: token.caption.slice(0, 300) });
      cursor = token.index + token.length;
    }
    cleaned = `${cleaned}${block.slice(cursor)}`.trim();
    const mappedBlock = cleaned ? outputBlocks.length : Math.max(0, outputBlocks.length - 1);
    blockMap.push(mappedBlock);
    if (cleaned) outputBlocks.push(cleaned);
    for (const image of accepted) embeddedImages.push({ ...image, afterBlock: mappedBlock });
  }

  const lastBlock = Math.max(0, outputBlocks.length - 1);
  const images = [];
  const seen = new Set();
  for (const image of embeddedImages) addImage(image);
  for (const image of Array.isArray(suppliedImages) ? suppliedImages : []) {
    const web = image?.type === "web" || /^https?:\/\//i.test(String(image?.path || ""));
    const path = web ? normalizeWebImagePath(image?.path) : normalizeImagePath(image?.path);
    if (!path) continue;
    const requestedBlock = Number(image?.afterBlock);
    const originalBlock = Number.isInteger(requestedBlock)
      ? Math.max(0, Math.min(blockMap.length - 1, requestedBlock))
      : blockMap.length - 1;
    addImage({
      path,
      caption: String(image?.caption || "").slice(0, 300),
      afterBlock: blockMap[originalBlock] ?? lastBlock,
      ...(web ? { type: "web" } : image?.type === "vault" ? { type: "vault" } : {})
    });
  }

  return { content: outputBlocks.join("\n\n"), images };

  function addImage(image) {
    if (images.length >= 3 || seen.has(image.path)) return;
    seen.add(image.path);
    images.push(image);
  }
}

function imageTokens(block) {
  const tokens = [];
  const markdownImage = /!\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/g;
  for (const match of block.matchAll(markdownImage)) {
    tokens.push({ index: match.index || 0, length: match[0].length, path: match[2] || match[3] || "", caption: match[1] || "" });
  }
  const htmlImage = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  for (const match of block.matchAll(htmlImage)) {
    const caption = match[0].match(/\balt=["']([^"']*)["']/i)?.[1] || "";
    tokens.push({ index: match.index || 0, length: match[0].length, path: match[1], caption });
  }
  return tokens.sort((left, right) => left.index - right.index);
}

function normalizeImagePath(value) {
  const raw = String(value || "").trim().split(/[?#]/, 1)[0].replace(/\\/g, "/").replace(/^\.\//, "");
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return "";
  }
  if (!IMAGE_PATH.test(decoded) || decoded.split("/").includes("..")) return "";
  return decoded;
}

function normalizeWebImagePath(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
    return url.href;
  } catch {
    return "";
  }
}
