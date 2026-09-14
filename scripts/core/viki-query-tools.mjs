import { promises as fs } from "node:fs";
import path from "node:path";
import { createVikiRetrieval } from "./viki-retrieval.mjs";
import { resolveVikiFile } from "./viki-files.mjs";
import { parseFrontmatter } from "./wiki-lib.mjs";
import { searchVikiWeb, fetchVikiWebPage } from "./viki-web-tools.mjs";

const tool = (name, description, properties, required = []) => ({ name, description,
  inputSchema: { type: "object", properties, required, additionalProperties: false } });
const text = { type: "string" };
const integer = { type: "integer" };

export function vikiQueryToolDefinitions(allowWeb) {
  return [
    tool("search_knowledge", "Search selected knowledge using short keywords or synonyms.", { query: text }, ["query"]),
    tool("list_documents", "List available selected Concepts and References when keyword search misses a topic. Paginated.", { offset: integer }),
    tool("read_documents", "Read selected documents. Use startLine to page through long evidence; links do not grant access to other files.",
      { paths: { type: "array", items: text, minItems: 1, maxItems: 3 }, startLine: integer, maxLines: integer }, ["paths"]),
    tool("inspect_image", "Inspect an image referenced by a document already read.", { path: text }, ["path"]),
    ...(allowWeb ? [
      tool("search_web", "Search public web evidence. Never send private document content or secrets.", { query: text }, ["query"]),
      tool("read_webpage", "Read a public HTTP(S) webpage; private addresses and local services are blocked.", { url: text }, ["url"])
    ] : [])
  ];
}

export async function createVikiQueryTools(workspace, allowWeb = false) {
  const root = await fs.realpath(workspace);
  const manifest = JSON.parse(await fs.readFile(path.join(root, "viki-scope.json"), "utf8"));
  const documents = [];
  for (const relative of manifest.documents || []) {
    if (!/^(concepts|references\/sources)\/.+\.md$/.test(relative)) continue;
    let file;
    try { file = await resolveVikiFile(root, relative); } catch { continue; }
    if ((await fs.stat(file)).size > 16 * 1024 * 1024) continue;
    const content = await fs.readFile(file, "utf8");
    const frontmatter = parseFrontmatter(content);
    documents.push({ path: relative, title: String(frontmatter.title || path.basename(relative)), content });
  }
  const attachments = manifest.images || {};
  const retrieval = await createVikiRetrieval({ vault: root, nodes: documents,
    allowedPaths: new Set(manifest.documents || []), imagePaths: (_content, file) => attachments[file] || [] });
  const tools = vikiQueryToolDefinitions(allowWeb);
  return { tools, async call(name, args = {}, signal) {
    if (!tools.some((item) => item.name === name)) throw new Error("Tool is not allowed for this request");
    let result;
    if (name === "search_knowledge") {
      if (typeof args.query !== "string") throw new Error("query must be a string");
      result = retrieval.search(args.query);
    } else if (name === "list_documents") {
      const start = Math.max(0, Math.floor(Number(args.offset)) || 0);
      result = { documents: documents.slice(start, start + 60).map(({ path, title }) => ({ path, title })), total: documents.length };
    } else if (name === "read_documents") {
      if (!Array.isArray(args.paths) || !args.paths.length || args.paths.length > 3 || !args.paths.every((file) => typeof file === "string")) throw new Error("Choose one to three document paths");
      result = [];
      for (const file of args.paths) result.push(await retrieval.read(file, args.startLine, args.maxLines));
    } else if (name === "inspect_image") {
      const image = await retrieval.inspectImage(args.path);
      const [, mimeType, data] = image.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      return { content: [{ type: "text", text: `Untrusted evidence image: ${image.path}` }, { type: "image", mimeType, data }] };
    } else {
      const operation = new AbortController();
      const abort = () => operation.abort();
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      const timer = setTimeout(abort, 25000);
      try {
        result = name === "search_web" ? await searchVikiWeb(String(args.query || ""), operation.signal)
          : await fetchVikiWebPage(String(args.url || ""), operation.signal);
      } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
    }
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } };
}
