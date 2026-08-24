import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractFrontmatterLinks as coreExtractFrontmatterLinks,
  extractLinks as coreExtractLinks,
  parseFrontmatter as coreParseFrontmatter,
  parseRelationHints as coreParseRelationHints,
  stripFrontmatter as coreStripFrontmatter,
  universeGraphGroup,
  wikiTopicPeerMap,
  wikiUniverseNames
} from "../../../scripts/core/wiki-lib.mjs";
import { readDeclaredUniverses } from "../../../scripts/core/universe-registry.mjs";

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

const scanRoots = ["references/sources", "concepts"];
const graphExcludedIds = new Set([
  "index",
  "log",
  "concepts/README",
  "concepts/Autodesk FlexSim 2026 Help",
  "concepts/FlexSim 2026 Ingest QA",
  "references/sources/autodesk-flexsim-2026/0000--table-of-contents"
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
  return coreParseFrontmatter(content);
}

function stripFrontmatter(content) {
  return coreStripFrontmatter(content);
}

function wikiContentForGraph(id, content) {
  if (!id.startsWith("concepts/")) return undefined;
  return stripFrontmatter(content).replace(/\r\n/g, "\n").trim();
}

function referencePreviewForGraph(id, content) {
  if (!id.startsWith("references/sources/")) return "";
  return stripFrontmatter(content)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280);
}

function asArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (value === undefined || value === null || value === "") return [];
  return [String(value)];
}

function visualGapPages(frontmatter, content) {
  const explicit = pageNumbers(frontmatter.extraction_missing_visual_pages);
  if (explicit.length) return explicit;
  const lowQuality = pageNumbers(frontmatter.extraction_low_quality_pages);
  if (!lowQuality.length) return [];
  const excluded = new Set([
    ...pageNumbers(frontmatter.extraction_blank_pages),
    ...pageNumbers(frontmatter.extraction_showthrough_pages),
    ...pageNumbers(frontmatter.extraction_suppressed_hallucination_pages)
  ]);
  const body = stripFrontmatter(content);
  const captureStart = body.search(/^## Capture\s*$/m);
  if (captureStart < 0) return [];
  const captureTail = body.slice(captureStart + body.slice(captureStart).match(/^## Capture\s*$/m)[0].length);
  const captureEnd = captureTail.search(/^## (?!#)/m);
  const capture = captureEnd < 0 ? captureTail : captureTail.slice(0, captureEnd);
  return lowQuality.filter((page) => {
    if (excluded.has(page)) return false;
    const marker = new RegExp(`^### Page ${page}\\s*$`, "m");
    const match = capture.match(marker);
    if (!match || match.index === undefined) return false;
    const tail = capture.slice(match.index + match[0].length);
    const next = tail.search(/^### Page \d+\s*$/m);
    const section = next < 0 ? tail : tail.slice(0, next);
    if (/!\[[^\]]*\]\([^)]+\)|<img\b/i.test(section)) return false;
    const meaningful = section.replace(/[`>*#_\-\s]/g, "").replace(new RegExp(`^${page}$`), "");
    return Array.from(meaningful.matchAll(/[\p{L}\p{N}\u3400-\u9fff]/gu)).length < 24;
  });
}

function pageNumbers(value) {
  const pages = new Set();
  for (const tokenValue of Array.isArray(value) ? value : String(value || "").split(",")) {
    const token = String(tokenValue || "").trim();
    const range = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (start > 0 && end >= start && end - start <= 10_000) {
        for (let page = start; page <= end; page += 1) pages.add(page);
      }
      continue;
    }
    const page = Number(token);
    if (Number.isInteger(page) && page > 0) pages.add(page);
  }
  return [...pages].sort((left, right) => left - right);
}

function extractWikiLinks(content, options) {
  return coreExtractLinks(content, options);
}

function relativeId(filePath) {
  return path
    .relative(vaultRoot, filePath)
    .replace(/\\/g, "/")
    .replace(/\.md$/, "");
}

function inferType(id, frontmatter) {
  if (id.startsWith("references/sources/")) return "raw-source";
  if (frontmatter.type) return String(frontmatter.type);
  if (id.startsWith("concepts/")) return "wiki";
  return "note";
}

function inferGroup(id, frontmatter) {
  if (id.startsWith("concepts/")) {
    const title = titleFromFrontmatter(frontmatter, id);
    return universeGraphGroup(wikiUniverseNames(frontmatter, title, asArray(frontmatter.tags))[0]);
  }
  if (frontmatter.group) return String(frontmatter.group);

  if (id.startsWith("references/sources/autodesk-flexsim-2026/")) {
    const tocPath = String(frontmatter.toc_path || "");
    const parts = tocPath
      .split(">")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length >= 2) return `FlexSim / ${parts[0]} / ${parts[1]}`;
    if (parts.length === 1) return `FlexSim / ${parts[0]}`;
    return "FlexSim / Corpus";
  }

  if (id.startsWith("references/sources/")) return "Raw / Other";
  return id.split("/")[0] || "Other";
}

function inferUniverses(id, frontmatter, primaryGroup) {
  if (!id.startsWith("concepts/")) return [primaryGroup];
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
  return coreExtractFrontmatterLinks(frontmatter);
}

function parseRelationHints(frontmatter) {
  return coreParseRelationHints(frontmatter);
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

  return (target, sourceId = "") => {
    let decoded = String(target || "").trim();
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      // Preserve malformed legacy escapes for unresolved-link reporting.
    }
    decoded = decoded.split("#")[0].split("?")[0].replace(/\\/g, "/");
    const pathLike = decoded.startsWith("/") || decoded.startsWith("./") || decoded.startsWith("../") || decoded.endsWith(".md");
    if (pathLike) {
      const rooted = decoded.startsWith("/")
        ? decoded.slice(1)
        : path.posix.normalize(path.posix.join(path.posix.dirname(sourceId), decoded));
      return byId.get(rooted.replace(/\.md$/, "").toLowerCase()) || null;
    }
    const normalized = decoded.replace(/\.md$/, "").toLowerCase();
    return byId.get(normalized) || byTitle.get(normalized) || byBase.get(normalized) || byAlias.get(normalized) || null;
  };
}

async function main() {
  const declaredUniverses = await readDeclaredUniverses(vaultRoot);
  const scannedFiles = await Promise.all(scanRoots.map((root) => walk(path.join(vaultRoot, root))));
  const files = scannedFiles.flat()
    .filter((file) => {
      const relative = path.relative(vaultRoot, file).replace(/\\/g, "/").toLowerCase();
      return !relative.startsWith("references/assets/") && !relative.startsWith("references/originals/");
    });
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
        status: id.startsWith("references/sources/")
          ? String(frontmatter.workflow_status || "unknown")
          : String(frontmatter.status || "unknown"),
        sourceType: id.startsWith("references/sources/") ? String(frontmatter.source_type || "") : "",
        sourceUrl: id.startsWith("references/sources/") ? String(frontmatter.source_url || "") : "",
        snapshotPath: id.startsWith("references/sources/") ? String(frontmatter.snapshot_path || "") : "",
        collection: id.startsWith("references/sources/") ? String(frontmatter.collection || "") : "",
        suggestedUniverse: id.startsWith("references/sources/") ? String(frontmatter.suggested_universe || "") : "",
        captured: id.startsWith("references/sources/") ? String(frontmatter.captured || "") : "",
        preview: referencePreviewForGraph(id, content),
        tags: asArray(frontmatter.tags),
        followupReasons: asArray(frontmatter.followup_reasons),
        visualGapPages: visualGapPages(frontmatter, content),
        content: wikiContentForGraph(id, content),
        supersededBy: String(frontmatter.superseded_by || ""),
        aliases: asArray(frontmatter.aliases),
        relations: parseRelationHints(frontmatter),
        links: Array.from(new Set([...extractWikiLinks(stripFrontmatter(content), { markdown: id.startsWith("concepts/") }), ...frontmatterLinks(frontmatter)]))
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
      const target = resolve(link, node.id);
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
      const target = resolve(relation.target, node.id);
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
    if (!node.id.startsWith("references/sources/") || node.status !== "processed") continue;
    const relatedLinks = asArray(loaded.find((item) => item.id === node.id)?.links ?? []).filter((link) => String(link).startsWith("concepts/") || resolve(link, node.id)?.startsWith("concepts/"));
    const resolvedRelated = relatedLinks.map((link) => resolve(link, node.id)).filter((target) => target && nodeMap.has(target));
    if (relatedLinks.length === 0) processedIssues.push({ source: node.id, reason: "missing-related" });
    if (relatedLinks.some((link) => !resolve(link, node.id))) processedIssues.push({ source: node.id, reason: "unresolved-related" });
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

  const inbox = nodes.filter((node) => node.id.startsWith("references/sources/") && node.status === "inbox").length;
  const needsFollowup = nodes.filter((node) => node.id.startsWith("references/sources/") && node.status === "needs-followup").length;
  const wikiTopicPeers = wikiTopicPeerMap({ nodes, edges, typedRelations });
  const stats = {
    nodes: nodes.length,
    edges: edges.length,
    typedRelations: typedRelations.length,
    rawSources: nodes.filter((node) => node.id.startsWith("references/sources/")).length,
    wikiPages: nodes.filter((node) => node.id.startsWith("concepts/")).length,
    pendingRaw: inbox + needsFollowup,
    inbox,
    processed: nodes.filter((node) => node.id.startsWith("references/sources/") && node.status === "processed").length,
    needsFollowup,
    stale: nodes.filter((node) => node.id.startsWith("references/sources/") && node.status === "stale").length,
    orphaned: Array.from(wikiTopicPeers.values()).filter((peers) => peers.size === 0).length,
    unresolved: unresolved.length,
    invalidRelations: invalidRelations.length,
    processedIssues: processedIssues.length
  };

  const graph = {
    generatedAt: new Date().toISOString(),
    vaultRoot,
    declaredUniverses,
    nodes,
    edges,
    typedRelations,
    invalidRelations,
    unresolved,
    unresolvedSummary,
    processedIssues,
    queues: {
      inbox: nodes.filter((node) => node.id.startsWith("references/sources/") && node.status === "inbox").map((node) => node.id),
      needsFollowup: nodes.filter((node) => node.id.startsWith("references/sources/") && node.status === "needs-followup").map((node) => node.id),
      stale: nodes
        .filter((node) => node.id.startsWith("references/sources/") && node.status === "stale" && !node.supersededBy)
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
