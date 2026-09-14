import { capturedHtmlToMarkdown } from "./capture-service.mjs";
import { readAnswerEvents } from "../../assets/dashboard/src/answer-events.js";
import { fetchPublicWebResource } from "./public-web.mjs";
import { inspectHtmlCapture } from "./html-original.mjs";
export { isPublicAddress as isPublicVikiAddress, validatePublicWebUrl as validateVikiWebUrl } from "./public-web.mjs";

export async function fetchPublicHtmlOriginal(value, { signal = AbortSignal.timeout(30000), fetcher } = {}) {
  const result = await fetchPublicWebResource(value, { signal, maxBytes: 20 * 1024 * 1024, htmlOnly: true, fetcher });
  if (!result.buffer.length) throw new Error("The webpage is empty; no document was replaced");
  inspectHtmlCapture(result.buffer.toString("utf8"), result.url);
  return result;
}

export async function fetchVikiWebPage(value, signal) {
  const result = await fetchPublicWebResource(value, { signal, maxBytes: 2 * 1024 * 1024 });
  const text = result.buffer.toString("utf8");
  const content = /html/.test(result.contentType) ? capturedHtmlToMarkdown(text, { sourceUrl: result.url }) : text;
  return { url: result.url, content: content.slice(0, 14000), truncated: content.length > 14000 };
}

export async function searchVikiWeb(query, signal) {
  const response = await fetch("https://mcp.exa.ai/mcp", { method: "POST", signal,
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "web_search_exa",
      arguments: { query: String(query).slice(0, 500), numResults: 5, type: "auto", livecrawl: "fallback", contextMaxCharacters: 12000 } } }) });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Web search HTTP ${response.status}`); }
  let payload;
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    await readAnswerEvents(response, (_type, data) => { if (data.id === 1) payload = data; });
  } else payload = await response.json();
  if (payload?.error || payload?.result?.isError) throw new Error("Web search is temporarily unavailable");
  return { content: (payload?.result?.content || []).filter((item) => item.type === "text").map((item) => item.text).join("\n").slice(0, 14000) };
}
