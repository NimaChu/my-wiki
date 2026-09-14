import { promises as fs } from "node:fs";
import path from "node:path";
import MiniSearch from "minisearch";
import { resolveVikiFile } from "./viki-files.mjs";

const segmenter = new Intl.Segmenter("zh", { granularity: "word" });
const tokenize = (text) => [...segmenter.segment(String(text).toLocaleLowerCase())].filter((part) => part.isWordLike).map((part) => part.segment);

export async function createVikiRetrieval({ vault, nodes, allowedPaths, imagePaths = () => [] }) {
  const root = await fs.realpath(vault);
  const documents = new Map();
  for (const node of nodes) {
    if (!/^(concepts|references\/sources)\/.+\.md$/.test(node.path) || (allowedPaths && !allowedPaths.has(node.path))) continue;
    try { await resolveVikiFile(root, node.path); documents.set(node.path, node); } catch {}
  }
  const images = new Set();
  const inspected = new Set();
  const index = new MiniSearch({ fields: ["title", "aliases", "body"], storeFields: ["path", "title"], tokenize });
  index.addAll([...documents.values()].map((node) => ({ id: node.path, path: node.path, title: node.title,
    aliases: (node.aliases || []).join(" "), body: String(node.content || node.preview || "").slice(0, 24000) })));
  const resolve = (relative) => resolveVikiFile(root, relative);
  const search = (query) => index.search(String(query).slice(0, 500), {
    boost: { title: 4, aliases: 3 }, prefix: true, fuzzy: false, combineWith: "OR"
  }).slice(0, 8).map((result) => ({ path: result.path, title: result.title,
    excerpt: String(documents.get(result.path).preview || documents.get(result.path).content || "").slice(0, 800) }));
  const read = async (relative, startLine = 1, maxLines = 120) => {
    if (!documents.has(relative)) throw new Error("Document is outside the selected knowledge scope");
    const file = await resolve(relative);
    const stat = await fs.stat(file);
    if (stat.size > 16 * 1024 * 1024) throw new Error("Reference is too large for interactive reading");
    const content = await fs.readFile(file, "utf8");
    const attached = [];
    for (const candidate of imagePaths(content, relative)) {
      if (!/^references\/(assets|originals)\//.test(candidate)) continue;
      try { await resolve(candidate); images.add(candidate); attached.push(candidate); } catch {}
    }
    inspected.add(relative);
    const lines = content.split(/\r?\n/);
    const start = Math.max(1, Math.min(lines.length, Math.floor(Number(startLine)) || 1));
    const limit = Math.max(1, Math.min(200, Math.floor(Number(maxLines)) || 120));
    const selected = lines.slice(start - 1, start - 1 + limit).join("\n");
    return { path: relative, title: documents.get(relative).title, startLine: start, totalLines: lines.length,
      content: selected.slice(0, 14000), truncated: selected.length > 14000 || start - 1 + limit < lines.length,
      images: attached.slice(0, 12) };
  };
  const inspectImage = async (relative) => {
    if (!images.has(relative)) throw new Error("Image was not referenced by inspected evidence");
    const extension = path.extname(relative).toLowerCase();
    const mime = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }[extension];
    if (!mime) throw new Error("Visual inspection supports PNG, JPEG and WebP");
    const file = await resolve(relative);
    if ((await fs.stat(file)).size > 4 * 1024 * 1024) throw new Error("Image exceeds the visual inspection limit");
    return { path: relative, dataUrl: `data:${mime};base64,${(await fs.readFile(file)).toString("base64")}` };
  };
  return { search, read, inspectImage, images, inspected };
}
