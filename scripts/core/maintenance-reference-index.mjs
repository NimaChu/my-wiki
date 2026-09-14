import { promises as fs } from "node:fs";
import path from "node:path";
import { asArray, parseFrontmatter, relativeId, textPreview, titleFromPath, walkMarkdown } from "./wiki-lib.mjs";
import { SOURCES_DIR, workflowStatus } from "./vault-layout.mjs";

// Queue state belongs to current References, not the asynchronously built graph.
export function createMaintenanceReferenceReader() {
  const vaults = new Map();
  const pending = new Map();
  return function read(vault) {
    const root = path.resolve(vault);
    if (pending.has(root)) return pending.get(root);
    const request = (async () => {
      const previous = vaults.get(root) || new Map();
      const next = new Map();
      const files = await walkMarkdown(path.join(root, SOURCES_DIR));
      for (let offset = 0; offset < files.length; offset += 48) {
        await Promise.all(files.slice(offset, offset + 48).map(async file => {
          try {
            const stat = await fs.lstat(file);
            if (!stat.isFile()) return;
            const stamp = `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
            const cached = previous.get(file);
            if (cached?.stamp === stamp) { next.set(file, cached); return; }
            const content = await fs.readFile(file, "utf8");
            const fm = parseFrontmatter(content);
            const id = relativeId(root, file);
            const item = {
              id, path: `${id}.md`,
              title: fm.title && !String(fm.title).includes("{{") ? String(fm.title) : titleFromPath(file),
              status: workflowStatus(fm, id),
              documentVersion: String(fm.document_version || ""),
              followupReasons: asArray(fm.followup_reasons),
              visualGapPages: asArray(fm.extraction_missing_visual_pages).map(Number).filter(page => Number.isInteger(page) && page > 0),
              sourceType: String(fm.source_type || ""),
              sourceUrl: String(fm.source_url || ""),
              snapshotPath: String(fm.snapshot_path || ""),
              collection: String(fm.collection || ""),
              suggestedUniverse: String(fm.suggested_universe || ""),
              captured: String(fm.captured || ""),
              preview: textPreview(content, 280)
            };
            next.set(file, { stamp, item });
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
          }
        }));
      }
      vaults.set(root, next);
      return [...next.values()].map(entry => entry.item)
        .sort((a, b) => b.captured.localeCompare(a.captured) || a.path.localeCompare(b.path));
    })().finally(() => pending.delete(root));
    pending.set(root, request);
    return request;
  };
}
