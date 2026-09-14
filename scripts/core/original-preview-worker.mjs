import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { renderPdfPages } from "./pdf-page-renderer.mjs";

const [file, directory, dependencyRoot] = process.argv.slice(2);
const require = createRequire(path.join(dependencyRoot, "package.json"));
const extension = path.extname(file).toLowerCase();
await fs.mkdir(directory, { recursive: true });
const textOutput = async (text) => fs.writeFile(path.join(directory, "preview.json"), JSON.stringify({ kind: "text", text: String(text).replace(/\u0000/g, "").trim().slice(0, 2400) }));

if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".pdf"].includes(extension)) {
  const canvasRuntime = require("@napi-rs/canvas");
  let source = file;
  if (extension === ".pdf") {
    const pages = await renderPdfPages({ file, pages: [1], outputDir: directory, dependencyRoot, environment: { MY_WIKI_VISUAL_REPAIR_SCALE: "1" } });
    source = pages[0]?.file;
    if (!source) throw new Error("PDF has no readable page");
  }
  const image = await canvasRuntime.loadImage(source);
  const scale = Math.min(1, 720 / Math.max(image.width, image.height));
  const canvas = canvasRuntime.createCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
  const context = canvas.getContext("2d");
  context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  await fs.writeFile(path.join(directory, "preview.png"), canvas.toBuffer("image/png"));
  if (extension === ".pdf") await fs.rm(source, { force: true });
} else if (extension === ".docx") {
  const result = await require("mammoth").extractRawText({ path: file });
  await textOutput(result.value);
} else if ([".pptx", ".xlsx"].includes(extension)) {
  const JSZip = require("jszip");
  const { XMLParser } = require("fast-xml-parser");
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  const xml = async (name) => {
    const entry = zip.file(name);
    if (!entry || entry._data?.uncompressedSize > 4 * 1024 * 1024) return "";
    return new XMLParser({ ignoreAttributes: false, processEntities: false }).parse(await entry.async("string"));
  };
  const texts = (value, key = "") => {
    if (Array.isArray(value)) return value.flatMap((item) => texts(item, key));
    if (value && typeof value === "object") return Object.entries(value).flatMap(([name, item]) => texts(item, name));
    return /(^|:)t$/.test(key) ? [String(value)] : [];
  };
  if (extension === ".pptx") await textOutput(texts(await xml("ppt/slides/slide1.xml")).join("\n"));
  else {
    const shared = await xml("xl/sharedStrings.xml");
    const strings = [shared?.sst?.si || []].flat().map((item) => texts(item).join(""));
    const worksheet = await xml("xl/worksheets/sheet1.xml");
    const rows = [worksheet?.worksheet?.sheetData?.row || []].flat().slice(0, 24);
    await textOutput(rows.map((row) => [row.c || []].flat().slice(0, 12).map((cell) => cell["@_t"] === "s" ? strings[Number(cell.v)] || "" : texts(cell).join("") || String(cell.v ?? "")).join(" | ")).join("\n"));
  }
} else if ([".md", ".txt", ".html", ".htm", ".csv", ".json"].includes(extension)) {
  const handle = await fs.open(file, "r");
  let text;
  try { const buffer = Buffer.alloc(128 * 1024); const { bytesRead } = await handle.read(buffer); text = buffer.subarray(0, bytesRead).toString("utf8"); }
  finally { await handle.close(); }
  if ([".html", ".htm"].includes(extension)) text = text.replace(/<(script|style|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
  else text = text.replace(/^---\r?\n[\s\S]*?\r?\n---\s*/, "");
  await textOutput(text);
} else await fs.writeFile(path.join(directory, "preview.json"), JSON.stringify({ kind: "unavailable" }));
