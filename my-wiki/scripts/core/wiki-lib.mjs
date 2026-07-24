import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { TOOL_ROOT, resolveVaultPath } from "./vault-config.mjs";

export const DEFAULT_VAULT = TOOL_ROOT;

function installationPort(value) {
  let hash = 0;
  for (const character of value.toLowerCase()) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  return 5173 + (hash % 400);
}

export const DASHBOARD_PORT = Number(process.env.MY_WIKI_DASHBOARD_PORT || installationPort(TOOL_ROOT));
export const DASHBOARD_URL = `http://127.0.0.1:${DASHBOARD_PORT}/`;
export const RELATION_TYPES = new Set([
  "supports",
  "challenges",
  "related_to",
  "applies_to",
  "company_of",
  "product_of"
]);
export const WIKI_UTILITY_IDS = new Set([
  "wiki/index",
  "wiki/log",
  "wiki/README",
  "wiki/Autodesk FlexSim 2026 Help",
  "wiki/FlexSim 2026 Ingest QA"
]);

const linkPattern = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;

export function vaultPath() {
  return resolveVaultPath();
}

export function dashboardPath() {
  return process.env.MY_WIKI_DASHBOARD_PATH
    ? path.resolve(process.env.MY_WIKI_DASHBOARD_PATH)
    : path.join(TOOL_ROOT, "assets", "dashboard");
}

export async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function walkMarkdown(dir) {
  if (!(await exists(dir))) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const full = path.join(dir, entry.name);
    if (entry.name === "node_modules" || entry.name === "dist") return [];
    if (entry.isDirectory()) return walkMarkdown(full);
    if (entry.isFile() && entry.name.endsWith(".md")) return [full];
    return [];
  }));
  return files.flat();
}

function frontmatterBounds(content) {
  const offset = content.charCodeAt(0) === 0xfeff ? 1 : 0;
  const start = content.slice(offset).match(/^---\r?\n/);
  if (!start) return null;
  const dataStart = offset + start[0].length;
  const rest = content.slice(dataStart);
  const end = rest.match(/\r?\n---(?=\r?\n|$)/);
  if (!end) return null;
  const dataEnd = dataStart + end.index;
  const blockEnd = dataEnd + end[0].length;
  return { dataStart, dataEnd, blockEnd };
}

export function stripFrontmatter(content) {
  const bounds = frontmatterBounds(content);
  if (!bounds) return content;
  return content.slice(bounds.blockEnd);
}

export function parseFrontmatter(content) {
  const bounds = frontmatterBounds(content);
  if (!bounds) return {};
  const data = {};
  let key = null;
  for (const line of content.slice(bounds.dataStart, bounds.dataEnd).split(/\r?\n/)) {
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (keyMatch) {
      key = keyMatch[1];
      const raw = keyMatch[2].trim();
      data[key] = raw ? parseScalar(raw) : [];
      continue;
    }
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item && key) {
      if (!Array.isArray(data[key])) data[key] = data[key] ? [data[key]] : [];
      data[key].push(parseScalar(item[1]));
    }
  }
  return data;
}

export function parseScalar(value) {
  const cleaned = cleanValue(value);
  if (/^\[\[[\s\S]+\]\]$/.test(cleaned)) return cleaned;
  if (/^\[(.*)\]$/.test(cleaned)) {
    return cleaned
      .slice(1, -1)
      .split(",")
      .map((item) => cleanValue(item))
      .filter(Boolean);
  }
  if (/^-?\d+(?:\.\d+)?$/.test(cleaned)) return Number(cleaned);
  if (cleaned === "true") return true;
  if (cleaned === "false") return false;
  return cleaned;
}

export function cleanValue(value) {
  return String(value).trim().replace(/^["']|["']$/g, "");
}

export function asArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (value === undefined || value === null || value === "") return [];
  return [String(value)];
}

export function extractLinks(content) {
  return Array.from(new Set(Array.from(content.matchAll(linkPattern), (match) => match[1].trim()).filter(Boolean)));
}

export function extractFrontmatterLinks(frontmatter, keys = ["related", "sources", "relation_hints"]) {
  return keys.flatMap((key) => asArray(frontmatter[key]).flatMap((value) => extractLinks(String(value))));
}

export function slugify(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .toLowerCase() || "untitled";
}

export function normalizeUniverseName(value) {
  const cleaned = String(value || "")
    .trim()
    .replace(/^Wiki\s*\/\s*/i, "")
    .replace(/^FlexSim\s*\/\s*/i, "");
  if (/^flexsim$/i.test(cleaned)) return "FlexSim";
  if (/^ai$/i.test(cleaned)) return "AI";
  return cleaned;
}

export function inferWikiUniverse(title, tags = []) {
  const label = `${title || ""} ${asArray(tags).join(" ")}`.toLowerCase();
  if (/flexsim/i.test(label)) return "FlexSim";
  return "AI";
}

export function wikiUniverseNames(nodeOrFrontmatter = {}, title = "", tags = []) {
  const frontmatter = nodeOrFrontmatter.frontmatter || nodeOrFrontmatter;
  const nodeTitle = nodeOrFrontmatter.title || title || frontmatter.title || "";
  const nodeTags = nodeOrFrontmatter.tags || tags || frontmatter.tags || [];
  const explicit = [...asArray(frontmatter.universes), ...asArray(frontmatter.universe)]
    .map(normalizeUniverseName)
    .filter(Boolean);
  if (explicit.length > 0) return Array.from(new Set(explicit));
  const legacy = normalizeUniverseName(frontmatter.group || "");
  if (legacy && legacy.toLowerCase() !== "unknown") return [legacy];
  return [inferWikiUniverse(nodeTitle, nodeTags)];
}

export function isWikiKnowledgeNode(nodeOrId) {
  const id = typeof nodeOrId === "string" ? nodeOrId : nodeOrId?.id || "";
  return id.startsWith("wiki/") && !WIKI_UTILITY_IDS.has(id);
}

export function universeGraphGroup(name) {
  return `Wiki / ${normalizeUniverseName(name)}`;
}

export function normalizeRawCollection(value, fallback = "general") {
  return slugify(String(value || fallback)).slice(0, 64) || fallback;
}

export function inferRawCollection({ collection = "", sourceUrl = "", sourceType = "", captureMethod = "" } = {}) {
  if (collection) return normalizeRawCollection(collection);
  if (sourceUrl) {
    try {
      const hostname = new URL(sourceUrl).hostname.toLowerCase().replace(/^(?:www|m)\./, "");
      if (hostname) return normalizeRawCollection(hostname.replace(/\./g, "-"));
    } catch {
      // Fall through to source metadata when the URL is incomplete.
    }
  }
  const source = `${sourceType} ${captureMethod}`.toLowerCase();
  if (source.includes("ima")) return "ima";
  if (/pdf|document|word|ppt|excel|archive/.test(source)) return "documents";
  if (/local|desktop|folder|offline/.test(source)) return "local-imports";
  return "general";
}

export function titleFromPath(filePath) {
  return path.basename(filePath, ".md");
}

export function yamlString(value) {
  return JSON.stringify(String(value ?? ""));
}

export function yamlList(values = []) {
  if (!values.length) return "";
  return values.map((value) => `  - ${yamlString(value)}`).join("\n");
}

export function relativeId(vault, filePath) {
  return path.relative(vault, filePath).replace(/\\/g, "/").replace(/\.md$/, "");
}

export function hashContent(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function textPreview(content, limit = 1600) {
  return stripFrontmatter(content)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/!\[\[[^\]]+\]\]/g, " ")
    .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, a, b) => b || a)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

export function parseRelationHints(frontmatter) {
  return asArray(frontmatter.relation_hints)
    .map((hint) => {
      const match = String(hint).match(/^([a-z_]+)\s*:\s*(.+)$/i);
      if (!match) return null;
      const kind = match[1].toLowerCase();
      const target = extractLinks(match[2])[0] || match[2].trim();
      if (!RELATION_TYPES.has(kind)) return { kind, target, invalid: true, raw: hint };
      return { kind, target, invalid: false, raw: hint };
    })
    .filter(Boolean);
}

export async function scanVault(vault = vaultPath()) {
  const roots = ["raw", "wiki", "templates", "_archive"];
  const files = (await Promise.all(roots.map((root) => walkMarkdown(path.join(vault, root))))).flat();
  const nodes = [];
  for (const file of files) {
    const content = await fs.readFile(file, "utf8");
    const frontmatter = parseFrontmatter(content);
    const id = relativeId(vault, file);
    const title = frontmatter.title && !String(frontmatter.title).includes("{{") ? String(frontmatter.title) : titleFromPath(file);
    const bodyLinks = extractLinks(stripFrontmatter(content));
    const frontmatterLinks = extractFrontmatterLinks(frontmatter);
    const links = Array.from(new Set([...bodyLinks, ...frontmatterLinks]));
    nodes.push({
      id,
      file,
      path: id + ".md",
      title,
      type: String(frontmatter.type || (id.startsWith("raw/") ? "raw-source" : "note")),
      status: String(frontmatter.status || "unknown"),
      tags: asArray(frontmatter.tags),
      aliases: asArray(frontmatter.aliases),
      sourceCount: Number(frontmatter.source_count || 0),
      links,
      bodyLinks,
      frontmatterLinks,
      relatedLinks: extractFrontmatterLinks(frontmatter, ["related"]),
      sourceLinks: extractFrontmatterLinks(frontmatter, ["sources"]),
      relations: parseRelationHints(frontmatter),
      frontmatter,
      content,
      excerpt: textPreview(content)
    });
  }

  const byTitle = new Map();
  const byBase = new Map();
  const byId = new Map();
  const byAlias = new Map();
  for (const node of nodes) {
    byTitle.set(node.title.toLowerCase(), node.id);
    byBase.set(path.basename(node.id).toLowerCase(), node.id);
    byId.set(node.id.toLowerCase(), node.id);
    for (const alias of node.aliases) byAlias.set(alias.toLowerCase(), node.id);
  }

  const resolve = (target) => {
    const normalized = target.replace(/\.md$/, "").replace(/\\/g, "/").toLowerCase();
    return byId.get(normalized) || byTitle.get(normalized) || byBase.get(normalized) || byAlias.get(normalized) || null;
  };

  const edges = [];
  const seenEdges = new Set();
  const unresolved = [];
  const typedRelations = [];
  const invalidRelations = [];

  for (const node of nodes) {
    for (const link of node.links) {
      const target = resolve(link);
      if (target) {
        const key = `${node.id}->${target}`;
        if (!seenEdges.has(key)) {
          seenEdges.add(key);
          edges.push({ source: node.id, target, kind: "wikilink" });
        }
      }
      else if (!node.id.startsWith("_archive/")) unresolved.push({ source: node.id, target: link });
    }
    for (const relation of node.relations) {
      if (relation.invalid) {
        invalidRelations.push({ source: node.id, relation: relation.raw, reason: "invalid-kind" });
        continue;
      }
      const target = resolve(relation.target);
      if (!target) {
        invalidRelations.push({ source: node.id, relation: relation.raw, reason: "unresolved-target" });
        continue;
      }
      typedRelations.push({ source: node.id, target, kind: relation.kind });
    }
  }

  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
    outgoing.set(edge.source, (outgoing.get(edge.source) || 0) + 1);
  }

  return { vault, nodes, edges, typedRelations, invalidRelations, unresolved, incoming, outgoing, resolve };
}

export function processedRawIssues(scan) {
  return scan.nodes
    .filter((node) => node.id.startsWith("raw/") && node.status === "processed")
    .flatMap((node) => {
      const issues = [];
      const relatedTargets = node.relatedLinks.map((link) => ({ link, target: scan.resolve(link) }));
      if (relatedTargets.length === 0) issues.push({ source: node.id, reason: "missing-related" });
      for (const item of relatedTargets.filter((item) => !item.target)) {
        issues.push({ source: node.id, reason: "unresolved-related", target: item.link });
      }
      const resolvedRelated = relatedTargets.map((item) => item.target).filter(Boolean);
      const hasWikiBacklink = scan.nodes.some((candidate) =>
        candidate.id.startsWith("wiki/") &&
        resolvedRelated.includes(candidate.id) &&
        candidate.links.includes(node.id)
      );
      if (resolvedRelated.length > 0 && !hasWikiBacklink) issues.push({ source: node.id, reason: "missing-wiki-backlink" });
      if (String(node.frontmatter.needs_followup || "") === "true") issues.push({ source: node.id, reason: "explicit-followup" });
      return issues;
    });
}

export function upsertFrontmatterValues(content, updates) {
  const bounds = frontmatterBounds(content);
  if (!bounds) return content;
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.slice(bounds.dataStart, bounds.dataEnd).split(/\r?\n/);
  const pending = new Map(Object.entries(updates));
  const output = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^([A-Za-z0-9_-]+):/);
    if (!match || !pending.has(match[1])) {
      output.push(lines[index]);
      continue;
    }
    const key = match[1];
    while (index + 1 < lines.length && /^\s+-\s+/.test(lines[index + 1])) index += 1;
    output.push(...frontmatterValueLines(key, pending.get(key)));
    pending.delete(key);
  }

  for (const [key, value] of pending) output.push(...frontmatterValueLines(key, value));
  return `${content.slice(0, bounds.dataStart)}${output.join(newline)}${content.slice(bounds.dataEnd)}`;
}

function frontmatterValueLines(key, value) {
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${key}: []`];
    return [`${key}:`, ...value.map((item) => `  - ${yamlString(item)}`)];
  }
  if (value === null || value === undefined || value === "") return [`${key}:`];
  if (typeof value === "number" || typeof value === "boolean") return [`${key}: ${value}`];
  return [`${key}: ${yamlString(value)}`];
}

export function rawLayoutIssues(scan) {
  return scan.nodes
    .filter((node) => node.id.startsWith("raw/") && node.type === "raw-source")
    .flatMap((node) => {
      const issues = [];
      const parts = node.id.split("/");
      if (parts[1] !== "sources" || parts.length !== 3) {
        issues.push({ source: node.id, reason: "misplaced-source" });
      }
      return issues;
    });
}

function localAttachmentTarget(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed || /^(?:https?:|data:|#|\/)/i.test(trimmed)) return "";
  const wrapped = trimmed.startsWith("<") && trimmed.includes(">");
  const raw = wrapped ? trimmed.slice(1, trimmed.indexOf(">")) : trimmed.match(/^\S+/)?.[0] || trimmed;
  const withoutAnchor = raw.split("#")[0].split("?")[0];
  try {
    return decodeURIComponent(withoutAnchor).replace(/\\/g, "/");
  } catch {
    return withoutAnchor.replace(/\\/g, "/");
  }
}

export async function rawAttachmentIssues(scan) {
  const issues = [];
  const seen = new Set();
  for (const node of scan.nodes.filter((candidate) => candidate.id.startsWith("raw/") || candidate.id.startsWith("wiki/"))) {
    const references = [];
    if (node.type === "raw-source") {
      for (const key of ["snapshot_path", "snapshot_markdown_path", "snapshot_html_path", "snapshot_json_path", "image_index_path"]) {
        const value = String(node.frontmatter[key] || "");
        if (value) references.push({ key, value, rootStyle: true });
      }
    }
    for (const match of node.content.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
      references.push({ key: "markdown-image", value: match[1], rootStyle: false });
    }
    for (const match of node.content.matchAll(/<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi)) {
      references.push({ key: "html-image", value: match[1] || match[2] || match[3], rootStyle: false });
    }

    for (const reference of references) {
      const target = localAttachmentTarget(reference.value);
      if (!target) continue;
      const rootStyle = reference.rootStyle || /^(?:raw|wiki|templates|_archive)\//.test(target);
      const resolved = rootStyle ? path.join(scan.vault, target) : path.resolve(path.dirname(node.file), target);
      const resolvedRelative = path.relative(scan.vault, resolved).replace(/\\/g, "/");
      const managedSyntax = /(?:^|\/)(?:assets|snapshots)(?:\/|$)/.test(target);
      const managedLocation = /^(?:raw\/(?:assets|snapshots))(?:\/|$)/.test(resolvedRelative);
      if (!reference.rootStyle && !managedSyntax && !managedLocation) continue;
      const key = `${node.id}|${reference.key}|${resolved.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!(await exists(resolved))) {
        issues.push({ source: node.id, field: reference.key, target: target.replace(/\\/g, "/") });
      }
    }
  }
  return issues;
}

export function statsFromScan(scan) {
  const inbox = scan.nodes.filter((node) => node.id.startsWith("raw/") && node.status === "inbox").length;
  const imaPointers = scan.nodes.filter((node) => node.id.startsWith("raw/") && node.status === "ima-pointer").length;
  const needsFollowup = scan.nodes.filter((node) => node.id.startsWith("raw/") && node.status === "needs-followup").length;
  return {
    nodes: scan.nodes.length,
    edges: scan.edges.length,
    typedRelations: scan.typedRelations.length,
    rawSources: scan.nodes.filter((node) => node.id.startsWith("raw/") && node.type === "raw-source").length,
    wikiPages: scan.nodes.filter((node) => node.id.startsWith("wiki/")).length,
    pendingRaw: inbox + imaPointers + needsFollowup,
    inbox,
    imaPointers,
    processed: scan.nodes.filter((node) => node.id.startsWith("raw/") && node.status === "processed").length,
    needsFollowup,
    stale: scan.nodes.filter((node) => node.id.startsWith("raw/") && node.status === "stale").length,
    unresolved: scan.unresolved.length,
    invalidRelations: scan.invalidRelations.length,
    rawLayoutIssues: rawLayoutIssues(scan).length,
    orphanedWiki: scan.nodes.filter((node) =>
      node.id.startsWith("wiki/") &&
      !["wiki/index", "wiki/log", "wiki/README"].includes(node.id) &&
      (scan.incoming.get(node.id) || 0) === 0 &&
      (scan.outgoing.get(node.id) || 0) === 0
    ).length
  };
}

export async function appendLog(message, vault = vaultPath()) {
  const logPath = path.join(vault, "wiki", "log.md");
  const stamp = new Date().toISOString();
  await fs.appendFile(logPath, `\n- [${stamp}] ${message}\n`, "utf8");
}
