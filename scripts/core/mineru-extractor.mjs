import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { assessPdfPage, qualityWarnings, summarizePdfQuality } from "./pdf-quality.mjs";

export async function extractPdfWithMineru({ file, pages = 0, cacheRoot = "", environment = process.env } = {}) {
  const command = String(environment.MY_WIKI_MINERU_COMMAND || "mineru").trim();
  const availability = await commandAvailable(command);
  if (!availability) return { status: "unavailable", method: "mineru", message: `MinerU command is not available: ${command}` };

  const temporaryRoot = cacheRoot || os.tmpdir();
  await fs.mkdir(temporaryRoot, { recursive: true });
  const outputRoot = await fs.mkdtemp(path.join(temporaryRoot, "my-wiki-mineru-"));
  const backend = String(environment.MY_WIKI_MINERU_BACKEND || "hybrid-engine").trim();
  const effort = String(environment.MY_WIKI_MINERU_EFFORT || "medium").trim();
  const language = String(environment.MY_WIKI_MINERU_LANGUAGE || "ch").trim();
  const timeout = Math.max(60_000, Number(environment.MY_WIKI_MINERU_TIMEOUT_MS || 12 * 60 * 60 * 1000));
  try {
    const args = ["-p", file, "-o", outputRoot, "-b", backend, "-l", language];
    if (backend.startsWith("hybrid-")) args.push("--effort", effort);
    const result = await runCommand(command, args, { timeout, environment });
    if (result.code !== 0) {
      return { status: "failed", method: "mineru", message: `MinerU failed (${result.code}): ${cleanError(result.stderr || result.stdout)}` };
    }
    const parsed = await readMineruOutput(outputRoot, pages);
    if (!parsed.content.trim()) return { status: "failed", method: "mineru", message: "MinerU completed without readable Markdown output." };
    const quality = summarizePdfQuality(parsed.pageResults, { method: "mineru" });
    const warnings = qualityWarnings(quality);
    const status = quality.level === "poor" ? "low-quality" : "complete";
    return {
      status,
      method: "mineru",
      engine: "mineru",
      content: `> Parsed locally with MinerU. The preserved PDF remains the layout reference.\n\n${parsed.content.trim()}`,
      pages: parsed.pages || pages,
      characters: meaningfulCharacterCount(parsed.content),
      units: parsed.pages || pages,
      unitLabel: "pages",
      confidence: quality.score,
      quality,
      warnings,
      message: status === "complete" ? warnings.join("; ") : `MinerU output did not meet the page-quality threshold. ${warnings.join("; ")}`.trim(),
      assets: []
    };
  } catch (error) {
    return {
      status: "failed",
      method: "mineru",
      engine: "mineru",
      message: `MinerU extraction failed: ${cleanError(error?.message || error)}`
    };
  } finally {
    await fs.rm(outputRoot, { recursive: true, force: true }).catch(() => {});
  }
}

export async function readMineruOutput(outputRoot, expectedPages = 0) {
  const files = await listFiles(outputRoot);
  const contentListFile = files.find((file) => /(?:^|_)content_list\.json$/i.test(path.basename(file)));
  if (contentListFile) {
    const entries = JSON.parse(await fs.readFile(contentListFile, "utf8"));
    if (Array.isArray(entries)) return mineruEntriesToMarkdown(entries, expectedPages);
  }
  const markdownFile = files.find((file) => file.toLowerCase().endsWith(".md"));
  if (!markdownFile) return { content: "", pages: expectedPages, pageResults: [] };
  const markdown = await fs.readFile(markdownFile, "utf8");
  const chunks = markdown.split(/^### Page \d+\s*$/m);
  if (chunks.length > 1) {
    const pageResults = chunks.slice(1).map((text, index) => assessPdfPage({ page: index + 1, text, method: "mineru" }));
    return { content: markdown, pages: pageResults.length, pageResults };
  }
  const result = assessPdfPage({ page: 1, text: markdown, method: "mineru" });
  return { content: markdown, pages: expectedPages || 1, pageResults: [result] };
}

export function mineruEntriesToMarkdown(entries, expectedPages = 0) {
  const grouped = new Map();
  for (const entry of entries) {
    const page = Number(entry.page_idx ?? entry.page_index ?? 0) + 1;
    if (!grouped.has(page)) grouped.set(page, []);
    const block = mineruBlock(entry);
    if (block) grouped.get(page).push(block);
  }
  const pages = Math.max(expectedPages, ...grouped.keys(), 0);
  const sections = [];
  const pageResults = [];
  for (let page = 1; page <= pages; page += 1) {
    const text = (grouped.get(page) || []).join("\n\n").trim();
    const result = assessPdfPage({ page, text, method: "mineru" });
    sections.push(`### Page ${page}\n\n${result.text || "_No text recognized on this page._"}`);
    pageResults.push(result);
  }
  return { content: sections.join("\n\n"), pages, pageResults };
}

function mineruBlock(entry) {
  const type = String(entry.type || "").toLowerCase();
  const captions = [...asTextList(entry.image_caption), ...asTextList(entry.table_caption)];
  const footnotes = [...asTextList(entry.image_footnote), ...asTextList(entry.table_footnote)];
  const text = String(
    entry.text
    || entry.content
    || entry.table_body
    || entry.html
    || captions.join("\n")
    || ""
  ).trim();
  if (!text) return "";
  if (type.includes("equation") || type.includes("formula")) return text.startsWith("$") ? text : `$$\n${text}\n$$`;
  if (type.includes("title")) return `## ${text.replace(/^#+\s*/, "")}`;
  if (type.includes("table")) return [captions.length ? `**${captions.join(" ")}**` : "", text, footnotes.join("\n")].filter(Boolean).join("\n\n");
  if (type.includes("image")) return [...captions, ...footnotes].filter(Boolean).join("\n\n");
  return [text, ...footnotes].filter(Boolean).join("\n\n");
}

function asTextList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  const text = String(value || "").trim();
  return text ? [text] : [];
}

async function commandAvailable(command) {
  if (path.isAbsolute(command)) return fs.access(command).then(() => true, () => false);
  const lookup = process.platform === "win32" ? ["where", command] : ["sh", "-lc", `command -v ${shellQuote(command)}`];
  const result = await runCommand(lookup[0], lookup.slice(1), { timeout: 10_000 }).catch(() => ({ code: 1 }));
  return result.code === 0;
}

function runCommand(command, args, { timeout, environment = process.env }) {
  return new Promise((resolve, reject) => {
    const noProxy = [environment.NO_PROXY, environment.no_proxy, "127.0.0.1", "localhost"].filter(Boolean).join(",");
    const taskTimeout = String(Math.ceil(timeout / 1000));
    const childEnvironment = {
      ...environment,
      NO_PROXY: noProxy,
      no_proxy: noProxy,
      MINERU_TASK_RESULT_TIMEOUT_SECONDS: environment.MINERU_TASK_RESULT_TIMEOUT_SECONDS || taskTimeout,
      PYTORCH_ENABLE_MPS_FALLBACK: environment.PYTORCH_ENABLE_MPS_FALLBACK || "1"
    };
    if (process.platform === "darwin") {
      childEnvironment.MINERU_HYBRID_BATCH_RATIO ||= "4";
      childEnvironment.MINERU_VIRTUAL_VRAM_SIZE ||= "8";
    }
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: childEnvironment });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Command timed out after ${timeout} ms: ${command}`));
    }, timeout);
    child.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-20_000); });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-20_000); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: Number(code), stdout, stderr }); });
  });
}

async function listFiles(root) {
  const output = [];
  const walk = async (directory) => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(file);
      else output.push(file);
    }
  };
  await walk(root);
  return output.sort();
}

function meaningfulCharacterCount(value) {
  return String(value || "").replace(/[\s`*_#>|\-:[\](){}.!?,;，。！？；：'"“”‘’/\\]/g, "").length;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function cleanError(error) {
  return String(error || "unknown error").replace(/[\r\n]+/g, " ").slice(0, 600);
}
