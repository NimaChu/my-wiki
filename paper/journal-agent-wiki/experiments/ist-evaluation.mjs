#!/usr/bin/env node
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import {
  processedRawIssues,
  scanVault,
  statsFromScan
} from "../../../src/wiki-lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const datasetDir = path.join(repoRoot, "datasets", "flexsim-2026-case-study");
const resultsPath = path.join(here, "ist-evaluation-results.json");
const runtimeCsvPath = path.join(here, "ist-runtime-results.csv");
const faultCsvPath = path.join(here, "ist-fault-injection-results.csv");
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-wiki-ist-"));

const FAULT_CLASSES = [
  "missing-related",
  "unresolved-related",
  "missing-wiki-backlink",
  "explicit-followup"
];
const FAULTS_PER_CLASS = 30;
const RUNTIME_SIZES = [100, 500, 1000, 2000];
const WARMUPS = 2;
const REPETITIONS = 10;

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function round(value, digits = 3) {
  return Number(value.toFixed(digits));
}

async function readJsonl(file) {
  const content = await fs.readFile(file, "utf8");
  return content.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

async function evaluatePublicDataset() {
  const [declared, rawRecords, wikiRecords, edges] = await Promise.all([
    fs.readFile(path.join(datasetDir, "metrics.json"), "utf8").then(JSON.parse),
    readJsonl(path.join(datasetDir, "raw-sources.jsonl")),
    readJsonl(path.join(datasetDir, "wiki-pages.jsonl")),
    readJsonl(path.join(datasetDir, "edges.jsonl"))
  ]);
  const edgeKeys = new Set(edges.map((edge) => `${edge.source}->${edge.target}`));
  const withResolvedRelated = rawRecords.filter((record) => record.resolved_related_ids.length > 0);
  const withReciprocalBacklink = rawRecords.filter((record) =>
    record.resolved_related_ids.some((wikiId) => edgeKeys.has(`${wikiId}->${record.id}`))
  );
  const withSourceUrl = rawRecords.filter((record) => Boolean(record.source_url));
  const withHash = rawRecords.filter((record) => /^[a-f0-9]{64}$/.test(record.content_hash_sha256));

  return {
    declared,
    observed: {
      raw_records: rawRecords.length,
      wiki_records: wikiRecords.length,
      edges: edges.length,
      raw_with_resolved_related_target: withResolvedRelated.length,
      raw_with_reciprocal_wiki_backlink: withReciprocalBacklink.length,
      raw_with_source_url: withSourceUrl.length,
      raw_with_sha256_hash: withHash.length,
      related_target_coverage_percent: round(100 * withResolvedRelated.length / rawRecords.length, 2),
      reciprocal_backlink_coverage_percent: round(100 * withReciprocalBacklink.length / rawRecords.length, 2),
      source_url_coverage_percent: round(100 * withSourceUrl.length / rawRecords.length, 2),
      content_hash_coverage_percent: round(100 * withHash.length / rawRecords.length, 2)
    }
  };
}

function rawDocument(index, topicIndex, fault) {
  const related = fault === "missing-related"
    ? ""
    : `related:\n  - "[[${fault === "unresolved-related" ? `Missing Topic ${index}` : `Topic ${topicIndex}`}]]"\n`;
  const followup = fault === "explicit-followup" ? "true" : "false";
  return `---\n` +
    `title: "Source ${index}"\n` +
    `type: raw-source\n` +
    `status: processed\n` +
    `needs_followup: ${followup}\n` +
    related +
    `---\n\n# Source ${index}\n\nSynthetic evidence record ${index}.\n`;
}

function wikiDocument(topicIndex, sourceIndexes, faultBySource) {
  const backlinks = sourceIndexes
    .filter((index) => faultBySource.get(index) !== "missing-wiki-backlink")
    .map((index) => `  - "[[raw/source-${String(index).padStart(5, "0")}]]"`)
    .join("\n");
  return `---\n` +
    `title: "Topic ${topicIndex}"\n` +
    `type: topic\n` +
    `status: active\n` +
    `sources:\n${backlinks}\n` +
    `---\n\n# Topic ${topicIndex}\n\nSynthesized topic ${topicIndex}.\n`;
}

async function createFixture(vault, rawCount, faultBySource = new Map()) {
  const rawDir = path.join(vault, "raw");
  const wikiDir = path.join(vault, "wiki");
  await Promise.all([
    fs.mkdir(rawDir, { recursive: true }),
    fs.mkdir(wikiDir, { recursive: true })
  ]);
  const topicCount = Math.max(1, Math.ceil(rawCount / 25));
  const topicSources = Array.from({ length: topicCount }, () => []);
  const writes = [];
  for (let index = 0; index < rawCount; index += 1) {
    const topicIndex = index % topicCount;
    topicSources[topicIndex].push(index);
    const name = `source-${String(index).padStart(5, "0")}.md`;
    writes.push(fs.writeFile(
      path.join(rawDir, name),
      rawDocument(index, topicIndex, faultBySource.get(index)),
      "utf8"
    ));
  }
  for (let topicIndex = 0; topicIndex < topicCount; topicIndex += 1) {
    writes.push(fs.writeFile(
      path.join(wikiDir, `topic-${String(topicIndex).padStart(4, "0")}.md`),
      wikiDocument(topicIndex, topicSources[topicIndex], faultBySource),
      "utf8"
    ));
  }
  await Promise.all(writes);
}

function classification(expectedKeys, detectedKeys) {
  const expected = new Set(expectedKeys);
  const detected = new Set(detectedKeys);
  const truePositive = [...detected].filter((key) => expected.has(key)).length;
  const falsePositive = [...detected].filter((key) => !expected.has(key)).length;
  const falseNegative = [...expected].filter((key) => !detected.has(key)).length;
  return {
    true_positive: truePositive,
    false_positive: falsePositive,
    false_negative: falseNegative,
    precision: detected.size ? round(truePositive / detected.size, 4) : 0,
    recall: expected.size ? round(truePositive / expected.size, 4) : 0
  };
}

async function runFaultInjection() {
  const vault = path.join(tempRoot, "fault-injection");
  const faultBySource = new Map();
  const expectedByClass = new Map(FAULT_CLASSES.map((fault) => [fault, []]));
  let index = 0;
  for (const fault of FAULT_CLASSES) {
    for (let sample = 0; sample < FAULTS_PER_CLASS; sample += 1) {
      faultBySource.set(index, fault);
      const source = `raw/source-${String(index).padStart(5, "0")}`;
      expectedByClass.get(fault).push(`${source}:${fault}`);
      index += 1;
    }
  }
  await createFixture(vault, 1000, faultBySource);
  const scan = await scanVault(vault);
  const agentIssues = processedRawIssues(scan);
  const agentKeys = agentIssues.map((issue) => `${issue.source}:${issue.reason}`);
  const baselineKeys = scan.unresolved
    .filter((issue) => issue.source.startsWith("raw/"))
    .map((issue) => `${issue.source}:unresolved-related`);
  const expectedKeys = [...expectedByClass.values()].flat();
  const byClass = {};
  for (const fault of FAULT_CLASSES) {
    byClass[fault] = {
      injected: expectedByClass.get(fault).length,
      agent_wiki_detected: expectedByClass.get(fault).filter((key) => agentKeys.includes(key)).length,
      existence_only_detected: expectedByClass.get(fault).filter((key) => baselineKeys.includes(key)).length
    };
  }
  return {
    fixture_raw_records: 1000,
    faults_per_class: FAULTS_PER_CLASS,
    total_injected_faults: expectedKeys.length,
    by_class: byClass,
    agent_wiki: classification(expectedKeys, agentKeys),
    existence_only_baseline: classification(expectedKeys, baselineKeys)
  };
}

async function timedCheck(vault) {
  const started = performance.now();
  const scan = await scanVault(vault);
  const stats = statsFromScan(scan);
  const issues = processedRawIssues(scan);
  return {
    milliseconds: performance.now() - started,
    nodes: stats.nodes,
    edges: stats.edges,
    issues: issues.length
  };
}

async function runRuntimeStudy() {
  const rows = [];
  for (const rawCount of RUNTIME_SIZES) {
    const vault = path.join(tempRoot, `runtime-${rawCount}`);
    await createFixture(vault, rawCount);
    for (let run = 0; run < WARMUPS; run += 1) await timedCheck(vault);
    const observations = [];
    let last = null;
    for (let run = 0; run < REPETITIONS; run += 1) {
      last = await timedCheck(vault);
      observations.push(last.milliseconds);
    }
    rows.push({
      raw_records: rawCount,
      wiki_records: Math.ceil(rawCount / 25),
      nodes: last.nodes,
      edges: last.edges,
      repetitions: REPETITIONS,
      median_ms: round(percentile(observations, 0.5)),
      p95_ms: round(percentile(observations, 0.95)),
      min_ms: round(Math.min(...observations)),
      max_ms: round(Math.max(...observations)),
      detected_issues: last.issues
    });
  }
  return rows;
}

function machineMetadata() {
  const cpu = os.cpus()[0];
  return {
    node: process.version,
    platform: os.platform(),
    release: os.release(),
    architecture: os.arch(),
    logical_cpu_count: os.cpus().length,
    cpu_model: cpu ? cpu.model.trim() : "unknown",
    memory_gib: round(os.totalmem() / (1024 ** 3), 1)
  };
}

function toCsv(rows, columns) {
  return [columns.join(","), ...rows.map((row) => columns.map((column) => row[column]).join(","))].join("\n") + "\n";
}

try {
  const publicDataset = await evaluatePublicDataset();
  const faultInjection = await runFaultInjection();
  const runtime = await runRuntimeStudy();
  const results = {
    schema_version: "1.0",
    generated_at: new Date().toISOString(),
    software_release: "v0.2.1",
    archive_package_release: "v0.2.2",
    machine: machineMetadata(),
    protocol: {
      fault_classes: FAULT_CLASSES,
      faults_per_class: FAULTS_PER_CLASS,
      runtime_sizes: RUNTIME_SIZES,
      warmups: WARMUPS,
      repetitions: REPETITIONS
    },
    public_dataset: publicDataset,
    fault_injection: faultInjection,
    runtime
  };
  await fs.writeFile(resultsPath, JSON.stringify(results, null, 2) + "\n", "utf8");
  await fs.writeFile(runtimeCsvPath, toCsv(runtime, [
    "raw_records", "wiki_records", "nodes", "edges", "repetitions",
    "median_ms", "p95_ms", "min_ms", "max_ms", "detected_issues"
  ]), "utf8");
  const faultRows = FAULT_CLASSES.map((fault) => ({ fault, ...faultInjection.by_class[fault] }));
  await fs.writeFile(faultCsvPath, toCsv(faultRows, [
    "fault", "injected", "agent_wiki_detected", "existence_only_detected"
  ]), "utf8");
  console.log(JSON.stringify(results, null, 2));
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
