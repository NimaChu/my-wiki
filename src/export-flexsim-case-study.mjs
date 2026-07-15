import { promises as fs } from "node:fs";
import path from "node:path";
import {
  hashContent,
  scanVault,
  stripFrontmatter,
  vaultPath
} from "./wiki-lib.mjs";

const DATASET_VERSION = "1.0.0";
const SOFTWARE_RELEASE = "v0.2.1";

function countWords(content) {
  return stripFrontmatter(content)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[[^\]]+\]\([^)]+\)/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function numberValue(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function quantile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * fraction)];
}

function jsonLines(records) {
  return records.map((record) => JSON.stringify(record)).join("\n") + "\n";
}

function resolvedIds(scan, links, selectedIds, prefix) {
  return Array.from(new Set(links
    .map((link) => scan.resolve(link))
    .filter((id) => id && selectedIds.has(id) && (!prefix || id.startsWith(prefix)))))
    .sort();
}

async function main() {
  const vault = vaultPath();
  const outputDir = path.join(vault, "datasets", "flexsim-2026-case-study");
  const scan = await scanVault(vault);
  const rawNodes = scan.nodes
    .filter((node) => node.id.startsWith("raw/autodesk-flexsim-2026/"))
    .sort((a, b) => a.id.localeCompare(b.id));
  const wikiNodes = scan.nodes
    .filter((node) => node.id.startsWith("wiki/FlexSim ") || node.id.startsWith("wiki/Autodesk FlexSim "))
    .sort((a, b) => a.id.localeCompare(b.id));

  if (rawNodes.length < 1000) {
    throw new Error(`Expected the authorized local FlexSim corpus; found ${rawNodes.length} raw notes.`);
  }

  const selectedIds = new Set([...rawNodes, ...wikiNodes].map((node) => node.id));
  const rawRecords = rawNodes.map((node) => ({
    id: node.id,
    title: node.title,
    source_url: String(node.frontmatter.source_url || ""),
    static_url: String(node.frontmatter.static_url || ""),
    autodesk_guid: String(node.frontmatter.autodesk_guid || ""),
    toc_path: String(node.frontmatter.toc_path || ""),
    sequence: numberValue(node.frontmatter.sequence),
    captured: String(node.frontmatter.captured || ""),
    content_hash_sha256: String(node.frontmatter.content_hash || ""),
    capture_method: String(node.frontmatter.capture_method || ""),
    source_quality: String(node.frontmatter.source_quality || ""),
    image_reference_count: numberValue(node.frontmatter.image_count),
    mirrored_image_count: numberValue(node.frontmatter.mirrored_image_count),
    related_targets: [...node.relatedLinks].sort(),
    resolved_related_ids: resolvedIds(scan, node.relatedLinks, selectedIds, "wiki/"),
    note_word_count: countWords(node.content),
    heading_count: (stripFrontmatter(node.content).match(/^#{1,6}\s+/gm) || []).length
  }));
  const wikiRecords = wikiNodes.map((node) => ({
    id: node.id,
    title: node.title,
    status: node.status,
    tags: [...node.tags].sort(),
    declared_source_count: numberValue(node.sourceCount),
    evidence_source_ids: resolvedIds(scan, node.links, selectedIds, "raw/"),
    outbound_wiki_ids: resolvedIds(scan, node.links, selectedIds, "wiki/"),
    note_word_count: countWords(node.content),
    heading_count: (stripFrontmatter(node.content).match(/^#{1,6}\s+/gm) || []).length,
    content_hash_sha256: hashContent(node.content)
  }));
  const edges = scan.edges
    .filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target))
    .map((edge) => ({ source: edge.source, target: edge.target, kind: edge.kind }))
    .sort((a, b) => `${a.source}\0${a.target}`.localeCompare(`${b.source}\0${b.target}`));
  const typedRelations = scan.typedRelations
    .filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target))
    .sort((a, b) => `${a.source}\0${a.target}\0${a.kind}`.localeCompare(`${b.source}\0${b.target}\0${b.kind}`));
  const rawWordCounts = rawRecords.map((record) => record.note_word_count);
  const metrics = {
    schema_version: "1.0",
    dataset_version: DATASET_VERSION,
    software_release: SOFTWARE_RELEASE,
    generated_at: new Date().toISOString(),
    corpus: "Autodesk FlexSim 2026 English online help",
    public_content_policy: "metadata-and-derived-structure-only",
    raw_source_records: rawRecords.length,
    synthesized_wiki_records: wikiRecords.length,
    graph_nodes: selectedIds.size,
    graph_edges: edges.length,
    typed_relation_edges: typedRelations.length,
    raw_to_wiki_edges: edges.filter((edge) => edge.source.startsWith("raw/") && edge.target.startsWith("wiki/")).length,
    wiki_to_raw_edges: edges.filter((edge) => edge.source.startsWith("wiki/") && edge.target.startsWith("raw/")).length,
    wiki_to_wiki_edges: edges.filter((edge) => edge.source.startsWith("wiki/") && edge.target.startsWith("wiki/")).length,
    notes_with_source_urls: rawRecords.filter((record) => record.source_url).length,
    notes_with_content_hashes: rawRecords.filter((record) => record.content_hash_sha256).length,
    raw_note_word_count_p10: quantile(rawWordCounts, 0.1),
    raw_note_word_count_median: quantile(rawWordCounts, 0.5),
    raw_note_word_count_p90: quantile(rawWordCounts, 0.9),
    captured_document_text_included: false,
    mirrored_images_included: false,
    webpage_snapshots_included: false
  };
  const schema = {
    schema_version: "1.0",
    files: {
      "raw-sources.jsonl": "Whitelisted source metadata and structural features for each captured help page.",
      "wiki-pages.jsonl": "Metadata and link-derived features for each synthesized FlexSim wiki page.",
      "edges.jsonl": "Resolved evidence and wiki-link edges whose endpoints are in this dataset.",
      "typed-relations.jsonl": "Supported typed relations within the selected subgraph.",
      "metrics.json": "Dataset-level counts and disclosure flags."
    },
    identifiers: {
      raw: "raw/autodesk-flexsim-2026/<local-note-id>",
      wiki: "wiki/<page-title>"
    },
    omitted_fields: [
      "captured document body",
      "webpage snapshot",
      "mirrored image",
      "absolute filesystem path",
      "credentials and personal contact data"
    ]
  };

  await fs.mkdir(outputDir, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(outputDir, "raw-sources.jsonl"), jsonLines(rawRecords), "utf8"),
    fs.writeFile(path.join(outputDir, "wiki-pages.jsonl"), jsonLines(wikiRecords), "utf8"),
    fs.writeFile(path.join(outputDir, "edges.jsonl"), jsonLines(edges), "utf8"),
    fs.writeFile(path.join(outputDir, "typed-relations.jsonl"), jsonLines(typedRelations), "utf8"),
    fs.writeFile(path.join(outputDir, "metrics.json"), JSON.stringify(metrics, null, 2) + "\n", "utf8"),
    fs.writeFile(path.join(outputDir, "schema.json"), JSON.stringify(schema, null, 2) + "\n", "utf8")
  ]);
  console.log(JSON.stringify({ outputDir, ...metrics }, null, 2));
}

await main();
