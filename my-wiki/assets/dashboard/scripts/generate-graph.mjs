import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { universeGraphGroup, wikiUniverseNames } from "../../../scripts/core/wiki-lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const toolRoot = path.resolve(appRoot, "../..");
const vaultRoot = path.resolve(
  process.env.MY_WIKI_VAULT ||
  process.env.KNOWLEDGE_VAULT_PATH ||
  process.env.KARPATHY_OBSIDIAN_VAULT ||
  process.env.OBSIDIAN_VAULT_PATH ||
  toolRoot
);
const outputPath = path.join(appRoot, "public", "wiki-graph.json");

const scanRoots = ["raw", "wiki"];
const markdownLinkPattern = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
const relationTypes = new Set(["supports", "challenges", "related_to", "applies_to", "company_of", "product_of"]);
const graphExcludedIds = new Set([
  "wiki/index",
  "wiki/log",
  "wiki/README",
  "wiki/Autodesk FlexSim 2026 Help",
  "wiki/FlexSim 2026 Ingest QA",
  "raw/autodesk-flexsim-2026/0000--table-of-contents"
]);

function isGraphExcluded(id) {
  return graphExcludedIds.has(id) || id === "README" || id.endsWith("/README");
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir) {
  if (!(await exists(dir))) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.name === "node_modules" || entry.name === "dist") return [];
      if (entry.isDirectory()) return walk(fullPath);
      if (entry.isFile() && entry.name.endsWith(".md")) return [fullPath];
      return [];
    })
  );
  return files.flat();
}

function parseFrontmatter(content) {
  const block = frontmatterBlock(content);
  if (!block) return {};
  const data = {};
  let currentKey = null;

  for (const rawLine of block.yaml.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (keyMatch) {
      currentKey = keyMatch[1];
      const value = keyMatch[2].trim();
      data[currentKey] = value ? parseScalar(value) : [];
      continue;
    }

    const listMatch = line.match(/^\s*-\s+(.*)$/);
    if (listMatch && currentKey) {
      if (!Array.isArray(data[currentKey])) data[currentKey] = data[currentKey] ? [data[currentKey]] : [];
      data[currentKey].push(parseScalar(listMatch[1]));
    }
  }

  return data;
}

function frontmatterBlock(content) {
  const cleaned = String(content).replace(/^\uFEFF/, "");
  const match = cleaned.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return null;
  return {
    yaml: match[1],
    bodyStart: match[0].length,
    content: cleaned
  };
}

function parseScalar(value) {
  const cleaned = cleanValue(value);
  if (/^\[\[[\s\S]+\]\]$/.test(cleaned)) return cleaned;
  if (cleaned.startsWith("[") && cleaned.endsWith("]")) {
    return cleaned
      .slice(1, -1)
      .split(",")
      .map((item) => cleanValue(item))
      .filter(Boolean);
  }
  return cleaned;
}

function cleanValue(value) {
  return String(value).trim().replace(/^["']|["']$/g, "");
}

function stripFrontmatter(content) {
  const block = frontmatterBlock(content);
  return block ? block.content.slice(block.bodyStart) : String(content).replace(/^\uFEFF/, "");
}

function wikiContentForGraph(id, content) {
  if (!id.startsWith("wiki/")) return undefined;
  return stripFrontmatter(content).replace(/\r\n/g, "\n").trim();
}

function asArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (value === undefined || value === null || value === "") return [];
  return [String(value)];
}

function extractWikiLinks(content) {
  return Array.from(new Set(Array.from(content.matchAll(markdownLinkPattern), (match) => match[1].trim()).filter(Boolean)));
}

function relativeId(filePath) {
  return path
    .relative(vaultRoot, filePath)
    .replace(/\\/g, "/")
    .replace(/\.md$/, "");
}

function inferType(id, frontmatter) {
  if (frontmatter.type) return String(frontmatter.type);
  if (id.startsWith("raw/")) return "raw-source";
  if (id.startsWith("wiki/")) return "wiki";
  return "note";
}

function inferGroup(id, frontmatter) {
  if (id.startsWith("wiki/")) {
    const title = titleFromFrontmatter(frontmatter, id);
    return universeGraphGroup(wikiUniverseNames(frontmatter, title, asArray(frontmatter.tags))[0]);
  }
  if (frontmatter.group) return String(frontmatter.group);

  if (id.startsWith("raw/autodesk-flexsim-2026/")) {
    const tocPath = String(frontmatter.toc_path || "");
    const parts = tocPath
      .split(">")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length >= 2) return `FlexSim / ${parts[0]} / ${parts[1]}`;
    if (parts.length === 1) return `FlexSim / ${parts[0]}`;
    return "FlexSim / Corpus";
  }

  if (id.startsWith("raw/")) return "Raw / Other";
  return id.split("/")[0] || "Other";
}

function inferUniverses(id, frontmatter, primaryGroup) {
  if (!id.startsWith("wiki/")) return [primaryGroup];
  const title = titleFromFrontmatter(frontmatter, id);
  return wikiUniverseNames(frontmatter, title, asArray(frontmatter.tags)).map(universeGraphGroup);
}

function titleFromId(id) {
  return path.basename(id);
}

function titleFromFrontmatter(frontmatter, id) {
  const title = frontmatter.title ? String(frontmatter.title) : "";
  if (!title || title.includes("{{")) return titleFromId(id);
  return title;
}

function frontmatterLinks(frontmatter) {
  return ["sources", "related", "relation_hints"].flatMap((key) =>
    asArray(frontmatter[key]).flatMap((value) => extractWikiLinks(String(value)))
  );
}

function parseRelationHints(frontmatter) {
  return asArray(frontmatter.relation_hints)
    .map((hint) => {
      const match = String(hint).match(/^([a-z_]+)\s*:\s*(.+)$/i);
      if (!match) return null;
      const kind = match[1].toLowerCase();
      const target = extractWikiLinks(match[2])[0] || match[2].trim();
      return {
        kind,
        target,
        raw: String(hint),
        invalid: !relationTypes.has(kind)
      };
    })
    .filter(Boolean);
}

function buildResolver(nodes) {
  const byId = new Map();
  const byTitle = new Map();
  const byBase = new Map();
  const byAlias = new Map();

  for (const node of nodes) {
    byId.set(node.id.toLowerCase(), node.id);
    byTitle.set(node.title.toLowerCase(), node.id);
    byBase.set(titleFromId(node.id).toLowerCase(), node.id);
    for (const alias of node.aliases) byAlias.set(alias.toLowerCase(), node.id);
  }

  return (target) => {
    const normalized = target.replace(/\.md$/, "").replace(/\\/g, "/").toLowerCase();
    return byId.get(normalized) || byTitle.get(normalized) || byBase.get(normalized) || byAlias.get(normalized) || null;
  };
}

async function main() {
  const files = (await Promise.all(scanRoots.map((root) => walk(path.join(vaultRoot, root))))).flat();
  const loaded = await Promise.all(
    files.map(async (filePath) => {
      const content = await fs.readFile(filePath, "utf8");
      const frontmatter = parseFrontmatter(content);
      const id = relativeId(filePath);
      const group = inferGroup(id, frontmatter);
      return {
        id,
        path: id + ".md",
        title: titleFromFrontmatter(frontmatter, id),
        type: inferType(id, frontmatter),
        group,
        universes: inferUniverses(id, frontmatter, group),
        status: String(frontmatter.status || "unknown"),
        tags: asArray(frontmatter.tags),
        content: wikiContentForGraph(id, content),
        supersededBy: String(frontmatter.superseded_by || ""),
        aliases: asArray(frontmatter.aliases),
        relations: parseRelationHints(frontmatter),
        links: Array.from(new Set([...extractWikiLinks(stripFrontmatter(content)), ...frontmatterLinks(frontmatter)]))
      };
    })
  );

  const graphLoaded = loaded.filter((node) => !isGraphExcluded(node.id));
  const resolve = buildResolver(loaded);
  const nodeMap = new Map(graphLoaded.map((node) => [node.id, { ...node, out: [], backlinks: [] }]));
  const edges = [];
  const seenEdges = new Set();
  const unresolved = [];
  const typedRelations = [];
  const invalidRelations = [];

  for (const node of graphLoaded) {
    for (const link of node.links) {
      const target = resolve(link);
      if (target && nodeMap.has(target)) {
        const key = `${node.id}->${target}`;
        if (!seenEdges.has(key)) {
          seenEdges.add(key);
          edges.push({ source: node.id, target, kind: "wikilink" });
          nodeMap.get(node.id).out.push(target);
          nodeMap.get(target).backlinks.push(node.id);
        }
      } else if (target) {
        continue;
      } else if (!node.id.startsWith("_archive/")) {
        unresolved.push({ source: node.id, target: link });
      }
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
      if (!nodeMap.has(target)) continue;
      typedRelations.push({ source: node.id, target, kind: relation.kind });
    }
  }

  const processedIssues = [];
  for (const node of nodeMap.values()) {
    if (!node.id.startsWith("raw/") || node.status !== "processed") continue;
    const relatedLinks = asArray(loaded.find((item) => item.id === node.id)?.links ?? []).filter((link) => String(link).startsWith("wiki/") || resolve(link)?.startsWith("wiki/"));
    const resolvedRelated = relatedLinks.map((link) => resolve(link)).filter((target) => target && nodeMap.has(target));
    if (relatedLinks.length === 0) processedIssues.push({ source: node.id, reason: "missing-related" });
    if (relatedLinks.some((link) => !resolve(link))) processedIssues.push({ source: node.id, reason: "unresolved-related" });
    const hasBacklink = resolvedRelated.some((targetId) => nodeMap.get(targetId)?.out.includes(node.id));
    if (resolvedRelated.length > 0 && !hasBacklink) processedIssues.push({ source: node.id, reason: "missing-wiki-backlink" });
  }

  const nodes = Array.from(nodeMap.values()).sort((a, b) => a.id.localeCompare(b.id));
  const unresolvedSummary = Array.from(
    unresolved.reduce((map, item) => {
      map.set(item.target, [...(map.get(item.target) ?? []), item.source]);
      return map;
    }, new Map())
  ).map(([target, sources]) => ({ target, count: sources.length, sources }));

  const inbox = nodes.filter((node) => node.id.startsWith("raw/") && node.status === "inbox").length;
  const needsFollowup = nodes.filter((node) => node.id.startsWith("raw/") && node.status === "needs-followup").length;
  const stats = {
    nodes: nodes.length,
    edges: edges.length,
    typedRelations: typedRelations.length,
    rawSources: nodes.filter((node) => node.id.startsWith("raw/")).length,
    wikiPages: nodes.filter((node) => node.id.startsWith("wiki/")).length,
    pendingRaw: inbox + needsFollowup,
    inbox,
    processed: nodes.filter((node) => node.id.startsWith("raw/") && node.status === "processed").length,
    needsFollowup,
    stale: nodes.filter((node) => node.id.startsWith("raw/") && node.status === "stale").length,
    orphaned: nodes.filter((node) => node.id.startsWith("wiki/") && node.backlinks.length === 0 && node.out.length === 0).length,
    unresolved: unresolved.length,
    invalidRelations: invalidRelations.length,
    processedIssues: processedIssues.length
  };

  const graph = {
    generatedAt: new Date().toISOString(),
    vaultRoot,
    nodes,
    edges,
    typedRelations,
    invalidRelations,
    unresolved,
    unresolvedSummary,
    processedIssues,
    queues: {
      inbox: nodes.filter((node) => node.id.startsWith("raw/") && node.status === "inbox").map((node) => node.id),
      needsFollowup: nodes.filter((node) => node.id.startsWith("raw/") && node.status === "needs-followup").map((node) => node.id),
      stale: nodes
        .filter((node) => node.id.startsWith("raw/") && node.status === "stale" && !node.supersededBy)
        .map((node) => node.id)
    },
    stats
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(graph, null, 2) + "\n", "utf8");
  console.log(`Generated ${path.relative(vaultRoot, outputPath)} with ${nodes.length} nodes and ${edges.length} edges.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
