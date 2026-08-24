import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  asArray,
  exists,
  extractLinks,
  parseFrontmatter,
  parseFrontmatterDocument,
  scanVault,
  stringifyFrontmatter,
  stripFrontmatter,
  textPreview,
  walkMarkdown,
  wikiUniverseNames
} from "./wiki-lib.mjs";

export const OKF_VERSION = "0.2";
export const OKF_STATUSES = new Set(["draft", "stable", "deprecated"]);
const RESERVED_FILES = new Set(["index.md", "log.md"]);
const CORE_KEYS = new Set([
  "type", "title", "description", "resource", "tags", "sources", "usage_window",
  "generated", "verified", "status", "stale_after"
]);
const wikilinkPattern = /(!)?\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g;

function isoNow() {
  return new Date().toISOString();
}

function slash(value) {
  return String(value || "").replace(/\\/g, "/");
}

function markdownPath(value) {
  return encodeURI(slash(value)).replace(/#/g, "%23");
}

function stableSourceId(resource) {
  return `source-${createHash("sha256").update(String(resource)).digest("hex").slice(0, 12)}`;
}

function sourceValues(value) {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null || value === "" ? [] : [value];
}

function sourceTarget(item) {
  if (item && typeof item === "object") return String(item.resource || "").trim();
  return extractLinks(String(item))[0] || String(item || "").trim();
}

function sourceEntry(item, node, scan) {
  const target = sourceTarget(item);
  const resolved = target ? scan.resolve(target, node.id) : null;
  const sourceNode = resolved ? scan.nodes.find((candidate) => candidate.id === resolved) : null;
  const resource = sourceNode?.id.startsWith("references/sources/")
    ? `/${sourceNode.path}`
    : target || String(item?.resource || "").trim();
  if (!resource) return null;
  const existing = item && typeof item === "object" ? item : {};
  const entry = {
    id: String(existing.id || "").trim() || stableSourceId(resource),
    resource,
    title: String(existing.title || sourceNode?.title || path.basename(resource, ".md")).trim()
  };
  for (const key of ["author", "usage_count", "last_modified", "usage_window"]) {
    if (existing[key] !== undefined && existing[key] !== "") entry[key] = existing[key];
  }
  return { entry, sourceNode };
}

function descriptionFromBody(content) {
  const body = stripFrontmatter(content);
  const preferred = ["Summary", "Definition", "Profile", "Scope", "Overview", "摘要", "定义", "简介"];
  let candidate = "";
  const lines = body.split(/\r?\n/);
  for (const heading of preferred) {
    const start = lines.findIndex((line) => new RegExp(`^##\\s+${heading}\\s*$`, "i").test(line));
    if (start >= 0) {
      const endOffset = lines.slice(start + 1).findIndex((line) => /^##\s+/.test(line));
      const end = endOffset >= 0 ? start + 1 + endOffset : lines.length;
      candidate = lines.slice(start + 1, end).join("\n").split(/\n\s*\n/).map((item) => item.trim()).find((item) => item && !/^[-*#>|]/.test(item)) || "";
      if (candidate) break;
    }
  }
  if (!candidate) candidate = textPreview(content, 500);
  const cleaned = candidate
    .replace(/\[\^[^\]]+\]/g, "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\[\[(?:raw\/)?sources\/[^\]]+\]\]/gi, "")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => label || target)
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const sentence = cleaned.match(/^(.{20,280}?[。！？.!?])/)?.[1] || cleaned.slice(0, 280);
  return sentence.trim();
}

function orderedFrontmatter(original, normalized) {
  const output = {};
  for (const key of ["type", "title", "description", "resource", "tags", "sources", "generated", "verified", "status", "stale_after"]) {
    if (normalized[key] !== undefined && normalized[key] !== "") output[key] = normalized[key];
  }
  for (const [key, value] of Object.entries(original)) {
    if (!CORE_KEYS.has(key) && value !== undefined) output[key] = value;
  }
  return output;
}

function standardizeMetadataLinks(value, node, scan) {
  const items = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return items.map((item) => String(item).replace(wikilinkPattern, (whole, image, target, anchor, label) => {
    const resolved = scan.resolve(target, node.id);
    const targetNode = resolved ? scan.nodes.find((candidate) => candidate.id === resolved) : null;
    const display = String(label || targetNode?.title || target).trim();
    const destination = targetNode ? `/${targetNode.path}${anchor ? `#${anchor}` : ""}` : `/concepts/${target}.md`;
    return `${image ? "!" : ""}[${display}](${markdownPath(destination)})`;
  }).replace(/^([a-z_]+)\s+(?=\[)/i, "$1: "));
}

function standardizeBody(node, scan, sources) {
  const sourceByNode = new Map();
  const sourceByResource = new Map();
  for (const source of sources) {
    if (source.sourceNode) sourceByNode.set(source.sourceNode.id, source.entry);
    sourceByResource.set(source.entry.resource, source.entry);
  }
  const cited = new Set();
  let currentHeading = "";
  const lines = stripFrontmatter(node.content).replace(/^\s+/, "").split(/\r?\n/);
  const converted = lines.map((line) => {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) currentHeading = heading[1].trim().toLowerCase();
    return line.replace(wikilinkPattern, (whole, image, target, anchor, label) => {
      const resolved = scan.resolve(target, node.id);
      const targetNode = resolved ? scan.nodes.find((candidate) => candidate.id === resolved) : null;
      const display = String(label || targetNode?.title || target).trim();
      if (!targetNode) {
        const fallback = `/concepts/${slash(target)}.md${anchor ? `#${anchor}` : ""}`;
        return `${image ? "!" : ""}[${display}](${markdownPath(fallback)})`;
      }
      const destination = `/${targetNode.path}${anchor ? `#${anchor}` : ""}`;
      if (image) return `![${display}](${markdownPath(destination)})`;
      if (targetNode.id.startsWith("references/sources/")) {
        const source = sourceByNode.get(targetNode.id) || sourceByResource.get(`/${targetNode.path}`);
        if (source && !/^sources?$/i.test(currentHeading)) {
          cited.add(source.id);
          return `[^${source.id}]`;
        }
      }
      return `[${display}](${markdownPath(destination)})`;
    });
  });

  let body = converted.join("\n").trimEnd();
  const footnotes = sources
    .map(({ entry }) => entry)
    .filter((entry) => cited.has(entry.id))
    .map((entry) => `[^${entry.id}]: [${entry.title}](${markdownPath(entry.resource)})`);
  if (footnotes.length > 0) {
    body = body.replace(new RegExp(`\\n?\\[\\^(?:${footnotes.map((line) => line.match(/^\[\^([^\]]+)/)[1]).join("|")})\\]:[^\\n]*(?:\\n|$)`, "g"), "\n").trimEnd();
    body += `\n\n${footnotes.join("\n")}`;
  }
  return body + "\n";
}

function standardizeReferenceBody(node, scan) {
  return stripFrontmatter(node.content).replace(/^\s+/, "").replace(wikilinkPattern, (whole, image, target, anchor, label) => {
    const resolved = scan.resolve(target, node.id);
    const targetNode = resolved ? scan.nodes.find((candidate) => candidate.id === resolved) : null;
    const display = String(label || targetNode?.title || target).trim();
    if (!targetNode) return display;
    const destination = `/${targetNode.path}${anchor ? `#${anchor}` : ""}`;
    return `${image ? "!" : ""}[${display}](${markdownPath(destination)})`;
  }).trimEnd() + "\n";
}

export function normalizeReferenceNode(node, scan, {
  generatedBy = "process:my-wiki-capture",
  generatedAt = ""
} = {}) {
  const original = parseFrontmatter(node.content);
  const extensions = { ...original };
  const attemptedWorkflow = ["inbox", "ima-pointer", "needs-followup", "processed", "stale"].includes(String(original.status))
    ? String(original.status)
    : String(original.workflow_status || "inbox");
  extensions.workflow_status = attemptedWorkflow;
  if (original.related !== undefined) extensions.related = standardizeMetadataLinks(original.related, node, scan);
  if (original.relation_hints !== undefined) extensions.relation_hints = standardizeMetadataLinks(original.relation_hints, node, scan);
  const captured = String(generatedAt || original.captured || "").trim();
  const resource = String(original.resource || original.source_url || original.snapshot_path || `/${node.path}`).trim();
  const normalized = orderedFrontmatter(extensions, {
    type: "Reference",
    title: String(original.title || node.title).trim(),
    description: String(original.description || "").trim() || descriptionFromBody(node.content),
    resource: resource.startsWith("/") || /^https?:\/\//i.test(resource) ? resource : `/${resource}`,
    tags: asArray(original.tags),
    sources: original.sources,
    generated: original.generated && typeof original.generated === "object"
      ? original.generated
      : { by: generatedBy, at: validTimestamp(captured) ? captured : isoNow() },
    verified: original.verified,
    status: OKF_STATUSES.has(String(original.status)) ? original.status : "stable",
    stale_after: original.stale_after
  });
  return `${stringifyFrontmatter(normalized)}\n\n${standardizeReferenceBody(node, scan)}`;
}

export function normalizeWikiConcept(node, scan, {
  generatedBy = "process:my-wiki-okf-normalizer",
  generatedAt = isoNow(),
  updateGenerated = false
} = {}) {
  const original = parseFrontmatter(node.content);
  const extensions = { ...original };
  if (original.relation_hints !== undefined) extensions.relation_hints = standardizeMetadataLinks(original.relation_hints, node, scan);
  if (original.related !== undefined) extensions.related = standardizeMetadataLinks(original.related, node, scan);
  const normalizedSources = sourceValues(original.sources)
    .map((item) => sourceEntry(item, node, scan))
    .filter(Boolean);
  const body = standardizeBody(node, scan, normalizedSources);
  const oldStatus = String(original.status || "").trim().toLowerCase();
  const status = OKF_STATUSES.has(oldStatus) ? oldStatus : oldStatus === "deprecated" ? "deprecated" : "stable";
  const generated = !updateGenerated && original.generated && typeof original.generated === "object"
    ? original.generated
    : { by: generatedBy, at: generatedAt };
  const normalized = orderedFrontmatter(extensions, {
    type: String(original.type || node.type || "Concept").trim() || "Concept",
    title: String(original.title || node.title).trim(),
    description: String(original.description || "").trim() || descriptionFromBody(node.content),
    resource: original.resource,
    tags: asArray(original.tags),
    sources: normalizedSources.map(({ entry }) => entry),
    generated,
    verified: original.verified,
    status,
    stale_after: original.stale_after
  });
  return `${stringifyFrontmatter(normalized)}\n\n${body}`;
}

function indexContent(nodes) {
  const groups = new Map();
  for (const node of nodes.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"))) {
    const group = wikiUniverseNames(node)[0] || "Knowledge";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(node);
  }
  const sections = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, "zh-CN")).map(([group, items]) => {
    const entries = items.map((node) => {
      const description = String(node.frontmatter.description || "").trim();
      return `* [${node.title}](./${markdownPath(path.basename(node.path))})${description ? ` - ${description}` : ""}`;
    });
    return `## ${group}\n\n${entries.join("\n")}`;
  });
  return `---\nokf_version: "${OKF_VERSION}"\n---\n\n# Knowledge Index\n\n${sections.join("\n\n")}\n`;
}

function normalizedLogContent(content, migrationDate = new Date().toISOString().slice(0, 10)) {
  const body = stripFrontmatter(content);
  const entries = [];
  let currentDate = "";
  for (const line of body.split(/\r?\n/)) {
    const dateHeading = line.match(/^##\s+(\d{4}-\d{2}-\d{2})\s*$/);
    if (dateHeading) {
      currentDate = dateHeading[1];
      continue;
    }
    const legacy = line.match(/^\s*-\s+\[([0-9]{4}-[0-9]{2}-[0-9]{2})T[^\]]+\]\s+(.+)$/);
    if (legacy) entries.push({ date: legacy[1], text: legacy[2].trim() });
    const okf = line.match(/^\s*\*\s+(.+)$/);
    if (okf && !/^\*\*Migration\*\*: Converted Wiki concepts/.test(okf[1].trim())) {
      entries.push({ date: currentDate, text: okf[1].trim() });
    }
  }
  const groups = new Map();
  for (const entry of entries) {
    const date = entry.date || migrationDate;
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(entry.text);
  }
  if (!groups.has(migrationDate)) groups.set(migrationDate, []);
  groups.get(migrationDate).unshift("**Migration**: Converted Wiki concepts and reserved files to OKF v0.2-compatible Markdown.");
  const sections = [...groups.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, items]) => `## ${date}\n${items.map((item) => `* ${item}`).join("\n")}`);
  return `# Knowledge Update Log\n\n${sections.join("\n\n")}\n`;
}

export async function backupWiki(vault, stamp = new Date().toISOString().replace(/[:.]/g, "-")) {
  const source = path.join(vault, "concepts");
  const target = path.join(vault, ".my-wiki", "backups", `okf-v0.2-${stamp}`, "concepts");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.cp(source, target, { recursive: true, errorOnExist: true });
  return target;
}

export async function migrateWikiToOkf(vault, { apply = false, backup = true } = {}) {
  const scan = await scanVault(vault);
  const concepts = scan.nodes.filter((node) => node.id.startsWith("concepts/") && !RESERVED_FILES.has(path.basename(node.path)));
  const references = scan.nodes.filter((node) => node.id.startsWith("references/sources/"));
  const changes = [];
  for (const node of concepts) {
    const normalized = normalizeWikiConcept(node, scan, { generatedBy: "process:my-wiki-okf-migration" });
    if (normalized !== node.content.replace(/^\uFEFF/, "")) changes.push({ node, normalized });
  }
  for (const node of references) {
    const normalized = normalizeReferenceNode(node, scan);
    if (normalized !== node.content.replace(/^\uFEFF/, "")) changes.push({ node, normalized });
  }
  let backupPath = "";
  if (apply) {
    if (backup) backupPath = await backupWiki(vault);
    for (const change of changes) await fs.writeFile(change.node.file, change.normalized, "utf8");
    const afterScan = await scanVault(vault);
    const migratedConcepts = afterScan.nodes.filter((node) => node.id.startsWith("concepts/") && !RESERVED_FILES.has(path.basename(node.path)));
    await fs.writeFile(path.join(vault, "index.md"), indexContent(migratedConcepts).replace(/\.\//g, "./concepts/"), "utf8");
    const logPath = path.join(vault, "log.md");
    const log = await exists(logPath) ? await fs.readFile(logPath, "utf8") : "";
    await fs.writeFile(logPath, normalizedLogContent(log), "utf8");
  }
  return { concepts: concepts.length, references: references.length, changed: changes.length, apply, backupPath };
}

function validActor(value) {
  const actor = String(value || "").trim();
  return /^(?:human:|process:).+/.test(actor) || /^[^/\s]+\/.+/.test(actor);
}

function validTimestamp(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(text) && !Number.isNaN(Date.parse(text));
}

export async function auditOkfWiki(vault) {
  return auditOkfDirectory(vault);
}

export async function auditOkfDirectory(bundleRoot) {
  const standardLayout = await exists(path.join(bundleRoot, "concepts"));
  const files = standardLayout
    ? [
        ...(await Promise.all(["index.md", "log.md"].map(async (name) => {
          const file = path.join(bundleRoot, name);
          return await exists(file) ? [file] : [];
        }))).flat(),
        ...await walkMarkdown(path.join(bundleRoot, "concepts")),
        ...await walkMarkdown(path.join(bundleRoot, "references", "sources"))
      ]
    : await walkMarkdown(bundleRoot);
  const issues = [];
  let concepts = 0;
  let references = 0;
  for (const file of files) {
    const relative = slash(path.relative(bundleRoot, file));
    const content = await fs.readFile(file, "utf8");
    const base = path.basename(file);
    if (content.charCodeAt(0) === 0xfeff) issues.push({ path: relative, code: "utf8-bom" });
    if (base === "index.md") {
      const parsed = parseFrontmatterDocument(content);
      if (relative === "index.md" && String(parsed.data.okf_version || "") !== OKF_VERSION) {
        issues.push({ path: relative, code: "missing-okf-version" });
      }
      const extras = Object.keys(parsed.data).filter((key) => key !== "okf_version");
      if (extras.length > 0) issues.push({ path: relative, code: "reserved-index-frontmatter", fields: extras });
      continue;
    }
    if (base === "log.md") {
      if (/^---\r?\n/.test(content)) issues.push({ path: relative, code: "reserved-log-frontmatter" });
      for (const heading of content.matchAll(/^##\s+(.+)$/gm)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(heading[1].trim())) issues.push({ path: relative, code: "invalid-log-date", value: heading[1].trim() });
      }
      continue;
    }
    const parsed = parseFrontmatterDocument(content);
    for (const error of parsed.errors) issues.push({ path: relative, code: "invalid-frontmatter", message: error });
    const data = parsed.data;
    if (String(data.type || "").toLowerCase() === "reference") references += 1;
    else concepts += 1;
    if (!String(data.type || "").trim()) issues.push({ path: relative, code: "missing-type" });
    if (data.status !== undefined && !OKF_STATUSES.has(String(data.status))) issues.push({ path: relative, code: "invalid-status", value: data.status });
    if (/\[\[[^\]]+\]\]/.test(JSON.stringify(data))) issues.push({ path: relative, code: "nonstandard-frontmatter-wikilink" });
    if (/\[\[[^\]]+\]\]/.test(stripFrontmatter(content))) issues.push({ path: relative, code: "nonstandard-wikilink" });
    for (const source of sourceValues(data.sources)) {
      if (!source || typeof source !== "object" || Array.isArray(source)) {
        issues.push({ path: relative, code: "invalid-source-entry" });
      } else if (!String(source.resource || "").trim()) {
        issues.push({ path: relative, code: "source-missing-resource", id: source.id || "" });
      }
    }
    if (data.generated !== undefined) {
      if (!data.generated || typeof data.generated !== "object" || !validActor(data.generated.by)) issues.push({ path: relative, code: "invalid-generated-actor" });
      if (data.generated?.at !== undefined && !validTimestamp(data.generated.at)) issues.push({ path: relative, code: "invalid-generated-time" });
    }
    const verified = data.verified === undefined ? [] : Array.isArray(data.verified) ? data.verified : [data.verified];
    for (const event of verified) {
      if (!event || typeof event !== "object" || !validActor(event.by)) issues.push({ path: relative, code: "invalid-verifier" });
      if (event?.at !== undefined && !validTimestamp(event.at)) issues.push({ path: relative, code: "invalid-verification-time" });
    }
  }
  return { okfVersion: OKF_VERSION, files: files.length, concepts, references, issues, valid: issues.length === 0 };
}

function exportedConceptContent(node, scan, rawDestinationById) {
  const normalized = normalizeWikiConcept(node, scan);
  const frontmatter = parseFrontmatter(normalized);
  frontmatter.sources = sourceValues(frontmatter.sources).map((source) => {
    if (!source || typeof source !== "object") return source;
    const target = scan.resolve(source.resource, node.id);
    return target && rawDestinationById.has(target)
      ? { ...source, resource: `/${rawDestinationById.get(target)}` }
      : source;
  });
  let body = stripFrontmatter(normalized).replace(/^\s+/, "");
  for (const wikiNode of scan.nodes.filter((candidate) => candidate.id.startsWith("concepts/") && !RESERVED_FILES.has(path.basename(candidate.path)))) {
    const from = markdownPath(`/${wikiNode.path}`);
    const to = markdownPath(`/concepts/${path.basename(wikiNode.path)}`);
    body = body.split(from).join(to).split(`/${wikiNode.path}`).join(`/concepts/${path.basename(wikiNode.path)}`);
  }
  for (const [rawId, destination] of rawDestinationById) {
    const rawNode = scan.nodes.find((candidate) => candidate.id === rawId);
    if (!rawNode) continue;
    body = body
      .split(markdownPath(`/${rawNode.path}`)).join(markdownPath(`/${destination}`))
      .split(`/${rawNode.path}`).join(`/${destination}`);
  }
  body = body.replace(/\.\.\/raw\/assets\//g, "../references/assets/");
  return `${stringifyFrontmatter(frontmatter)}\n\n${body.trimEnd()}\n`;
}

function exportedReferenceContent(node, scan, conceptDestinationById, originalDestination = "") {
  const original = parseFrontmatter(node.content);
  const external = String(original.source_url || original.static_url || "").trim();
  const frontmatter = {
    type: "Reference",
    title: node.title,
    description: descriptionFromBody(node.content),
    resource: external || (originalDestination ? `/${originalDestination}` : `/${node.path}`),
    tags: Array.from(new Set(["source", ...asArray(original.tags).filter((tag) => tag !== "raw")])),
    generated: { by: "process:my-wiki-okf-export", at: isoNow() },
    status: "stable"
  };
  let currentHeading = "";
  const body = stripFrontmatter(node.content).replace(/^\s+/, "").split(/\r?\n/).map((line) => {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) currentHeading = heading[1].trim();
    return line.replace(wikilinkPattern, (whole, image, target, anchor, label) => {
      const resolved = scan.resolve(target, node.id);
      const destination = resolved ? conceptDestinationById.get(resolved) : "";
      const display = String(label || scan.nodes.find((candidate) => candidate.id === resolved)?.title || target).trim();
      if (!destination) return display;
      return `${image ? "!" : ""}[${display}](${markdownPath(`/${destination}${anchor ? `#${anchor}` : ""}`)})`;
    });
  }).join("\n");
  return `${stringifyFrontmatter(frontmatter)}\n\n${body.trimEnd()}\n`;
}

async function copyIfPresent(source, destination) {
  if (!source || !(await exists(source))) return false;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(source, destination, { recursive: true });
  return true;
}

export async function exportOkfBundle(vault, { galaxy = "", output = "" } = {}) {
  const scan = await scanVault(vault);
  const allConcepts = scan.nodes.filter((node) => node.id.startsWith("concepts/") && !RESERVED_FILES.has(path.basename(node.path)));
  const concepts = galaxy
    ? allConcepts.filter((node) => wikiUniverseNames(node).some((name) => name.toLowerCase() === galaxy.toLowerCase()))
    : allConcepts;
  if (concepts.length === 0) throw new Error(galaxy ? `No Wiki concepts found for galaxy: ${galaxy}` : "No Wiki concepts found");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const label = (galaxy || "all").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "all";
  const bundleRoot = path.resolve(output || path.join(vault, ".my-wiki", "exports", `${label}-okf-v0.2-${stamp}`));
  if (await exists(bundleRoot)) throw new Error(`OKF output already exists: ${bundleRoot}`);
  await fs.mkdir(path.join(bundleRoot, "concepts"), { recursive: true });

  const conceptDestinationById = new Map(concepts.map((node) => [node.id, `concepts/${path.basename(node.path)}`]));
  const rawNodes = new Map();
  for (const concept of concepts) {
    for (const item of sourceValues(concept.frontmatter.sources)) {
      const resolved = scan.resolve(sourceTarget(item), concept.id);
      const sourceNode = resolved ? scan.nodes.find((candidate) => candidate.id === resolved) : null;
      if (sourceNode?.id.startsWith("references/sources/")) rawNodes.set(sourceNode.id, sourceNode);
    }
  }
  const rawDestinationById = new Map([...rawNodes.values()].map((node) => [node.id, `references/sources/${path.basename(node.path)}`]));

  for (const concept of concepts) {
    await fs.writeFile(
      path.join(bundleRoot, conceptDestinationById.get(concept.id)),
      exportedConceptContent(concept, scan, rawDestinationById),
      "utf8"
    );
  }

  let originals = 0;
  let assetDirectories = 0;
  for (const source of rawNodes.values()) {
    const original = parseFrontmatter(source.content);
    const snapshot = String(original.snapshot_path || original.snapshot_markdown_path || original.snapshot_html_path || "").trim();
    let originalDestination = "";
    if (snapshot) {
      const sourcePath = path.join(vault, slash(snapshot).replace(/^\//, ""));
      originalDestination = `references/originals/${path.basename(sourcePath)}`;
      if (await copyIfPresent(sourcePath, path.join(bundleRoot, originalDestination))) originals += 1;
    }
    const assetSource = path.join(vault, "references", "assets", path.basename(source.id));
    const assetDestination = path.join(bundleRoot, "references", "assets", path.basename(source.id));
    if (await copyIfPresent(assetSource, assetDestination)) assetDirectories += 1;
    const referenceContent = exportedReferenceContent(source, scan, conceptDestinationById, originalDestination)
      .replace(/\.\.\/assets\//g, "../assets/")
      .replace(/references\/originals\//g, "../originals/");
    const destination = path.join(bundleRoot, rawDestinationById.get(source.id));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, referenceContent, "utf8");
  }

  const exportedNodes = concepts.map((node) => ({
    ...node,
    path: conceptDestinationById.get(node.id),
    frontmatter: parseFrontmatter(exportedConceptContent(node, scan, rawDestinationById))
  }));
  const rootIndex = indexContent(exportedNodes).replace(/\.\//g, "./concepts/");
  await fs.writeFile(path.join(bundleRoot, "index.md"), rootIndex, "utf8");
  await fs.writeFile(path.join(bundleRoot, "log.md"), `# Knowledge Update Log\n\n## ${new Date().toISOString().slice(0, 10)}\n* **Export**: Created an OKF v0.2 bundle from My Wiki${galaxy ? ` galaxy ${galaxy}` : ""}.\n`, "utf8");
  const manifest = {
    format: "okf",
    okf_version: OKF_VERSION,
    created_at: isoNow(),
    producer: "my-wiki",
    galaxy: galaxy || null,
    concepts: concepts.length,
    sources: rawNodes.size,
    originals,
    asset_directories: assetDirectories
  };
  await fs.writeFile(path.join(bundleRoot, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  const audit = await auditOkfDirectory(bundleRoot);
  if (!audit.valid) throw new Error(`Generated OKF bundle failed audit: ${JSON.stringify(audit.issues.slice(0, 10))}`);
  return { output: bundleRoot, manifest, audit };
}

export async function normalizeChangedWikiFiles(vault, beforeWikiContent, { generatedBy, generatedAt = isoNow() } = {}) {
  const scan = await scanVault(vault);
  let changed = false;
  for (const node of scan.nodes) {
    const isConcept = node.id.startsWith("concepts/") && !RESERVED_FILES.has(path.basename(node.path));
    const isReference = node.id.startsWith("references/sources/");
    if ((!isConcept && !isReference) || beforeWikiContent.get(node.id) === node.content) continue;
    const normalized = isReference
      ? normalizeReferenceNode(node, scan, { generatedBy, generatedAt })
      : normalizeWikiConcept(node, scan, { generatedBy, generatedAt, updateGenerated: true });
    if (normalized !== node.content) {
      await fs.writeFile(node.file, normalized, "utf8");
      changed = true;
    }
  }
  if (changed) {
    const afterScan = await scanVault(vault);
    const concepts = afterScan.nodes.filter((node) => node.id.startsWith("concepts/") && !RESERVED_FILES.has(path.basename(node.path)));
    await fs.writeFile(path.join(vault, "index.md"), indexContent(concepts).replace(/\.\//g, "./concepts/"), "utf8");
  }
  return changed;
}
