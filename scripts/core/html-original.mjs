import { parse } from "parse5";
import { fetchPublicWebResource, validatePublicWebUrl } from "./public-web.mjs";

const omitted = new Set(["script", "style", "noscript", "template", "nav", "footer", "form", "iframe", "object", "embed", "svg", "canvas", "video", "audio", "link", "meta", "base"]);
const tags = new Set(["article", "section", "main", "div", "p", "span", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "pre", "code", "strong", "b", "em", "i", "u", "s", "del", "sub", "sup", "br", "hr", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "figure", "figcaption", "details", "summary", "dl", "dt", "dd"]);
const attribute = (node, name) => node.attrs?.find(item => item.name === name)?.value || "";
const escape = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
function find(node, predicate) {
  if (predicate(node)) return node;
  for (const child of node.childNodes || []) { const result = find(child, predicate); if (result) return result; }
}
function visibleText(node) {
  if (["script", "style", "noscript", "template"].includes(node.tagName)) return "";
  return node.nodeName === "#text" ? node.value : (node.childNodes || []).map(visibleText).join(" ");
}

export function inspectHtmlCapture(html, sourceUrl = "") {
  const document = parse(String(html));
  const article = find(document, node => attribute(node, "id") === "js_content");
  const body = find(document, node => node.tagName === "body") || document;
  const text = visibleText(body).replace(/\s+/g, " ").trim();
  const title = visibleText(find(document, node => node.tagName === "title") || {}).trim();
  let challengeUrl = false;
  try { challengeUrl = /\/(?:mp\/wappoc_appmsgcaptcha|cdn-cgi\/challenge-platform)(?:\/|$)/i.test(new URL(sourceUrl).pathname); } catch {}
  const challenge = challengeUrl || (!article && text.length < 2500 && (
    (/环境异常/.test(text) && /完成验证|去验证/.test(text))
    || (/verify (?:that )?you are human|checking your browser|enable javascript and cookies to continue/i.test(text) && /just a moment|security verification|security check|captcha|cloudflare/i.test(`${title} ${text}`))
  ));
  if (challenge) throw Object.assign(new Error("网页返回了验证码或安全验证页，不是文章正文。请在浏览器完成验证后保存完整 HTML 再上传。"), { code: "webpage:verification-required" });
  const scope = article || find(body, node => node.tagName === "article") || find(body, node => node.tagName === "main") || body;
  if (!visibleText(scope).trim() && !find(scope, node => node.tagName === "img")) throw new Error("The webpage contains no readable article content");
  return { document, scope, title };
}

function imageType(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217) return "jpeg";
  if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString())) return "gif";
  if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") return "webp";
  throw new Error("Offline images must contain valid PNG, JPEG, GIF or WebP data");
}

function dataImage(source) {
  const match = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=\s]+)$/i.exec(source);
  if (!match || source.length > 14 * 1024 * 1024) throw new Error("Unsupported or oversized embedded image");
  const buffer = Buffer.from(match[2], "base64");
  const type = imageType(buffer);
  if (type !== match[1].toLowerCase()) throw new Error("Embedded image content does not match its type");
  return { buffer, type };
}

export function inlineHtmlImageAssets(html) {
  const document = parse(String(html));
  const assets = new Map();
  function visit(node) {
    if (omitted.has(node.tagName)) return;
    const source = attribute(node, "src");
    if (node.tagName === "img" && source.startsWith("data:") && !assets.has(source)) {
      const { buffer, type } = dataImage(source);
      assets.set(source, { name: `embedded-${assets.size + 1}.${type === "jpeg" ? "jpg" : type}`, reference: source, buffer, alt: attribute(node, "alt") });
    }
    for (const child of node.childNodes || []) visit(child);
  }
  visit(document);
  return [...assets.values()];
}

export async function createOfflineHtml(html, { sourceUrl = "", title = "", loadImage, signal = AbortSignal.timeout(60000) } = {}) {
  const parsed = inspectHtmlCapture(html, sourceUrl);
  const images = new Map();
  let imageBytes = 0;
  const getImage = async source => {
    if (images.has(source)) return images.get(source);
    if (images.size >= 128) throw new Error("Too many images for a single offline HTML file");
    let image;
    if (source.startsWith("data:")) image = dataImage(source);
    else {
      const url = validatePublicWebUrl(new URL(source, sourceUrl).href).href;
      const result = loadImage ? await loadImage(url) : await fetchPublicWebResource(url, { signal, maxBytes: 10 * 1024 * 1024, imageOnly: true });
      const buffer = Buffer.isBuffer(result) ? result : result.buffer;
      if (!Buffer.isBuffer(buffer) || buffer.length > 10 * 1024 * 1024) throw new Error("Offline image exceeds the size limit");
      image = { buffer, type: imageType(buffer) };
    }
    imageBytes += image.buffer.length;
    if (imageBytes > 40 * 1024 * 1024) throw new Error("Offline image bundle exceeds the size limit");
    const value = `data:image/${image.type};base64,${image.buffer.toString("base64")}`;
    images.set(source, value);
    return value;
  };
  const render = async node => {
    if (omitted.has(node.tagName)) return "";
    if (node.nodeName === "#text") return escape(node.value);
    if (node.nodeName === "#comment") return "";
    if (node.tagName === "img") {
      const source = attribute(node, "data-src") || attribute(node, "src");
      if (!source) return "";
      try { return `<img src="${escape(await getImage(source))}" alt="${escape(attribute(node, "alt"))}">`; }
      catch (error) { throw new Error(`无法制作完整离线网页：第 ${images.size + 1} 张图片保存失败（${error.message}）。当前版本未被替换。`); }
    }
    let children = "";
    for (const child of node.childNodes || []) children += await render(child);
    if (node.tagName === "a") {
      let href = "";
      try { const url = new URL(attribute(node, "href"), sourceUrl); if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) href = url.href; } catch {}
      return href ? `<a href="${escape(href)}" target="_blank" rel="noreferrer">${children}</a>` : children;
    }
    if (!tags.has(node.tagName)) return children;
    let attrs = node === parsed.scope && attribute(node, "id") === "js_content" ? ' id="js_content" class="rich_media_content"' : "";
    if (["td", "th"].includes(node.tagName)) for (const key of ["colspan", "rowspan"]) { const value = attribute(node, key); if (/^[1-9]\d?$/.test(value)) attrs += ` ${key}="${value}"`; }
    return ["br", "hr"].includes(node.tagName) ? `<${node.tagName}>` : `<${node.tagName}${attrs}>${children}</${node.tagName}>`;
  };
  const content = await render(parsed.scope);
  const name = title || parsed.title || "Article";
  let source = "";
  try { source = validatePublicWebUrl(sourceUrl).href; } catch {}
  const output = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="my-wiki-offline" content="1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escape(name)}</title><style>body{margin:0;background:#fff;color:#202124;font:17px/1.85 system-ui,sans-serif;overflow-wrap:anywhere}main{max-width:860px;margin:auto;padding:28px 20px}h1{font-size:28px;line-height:1.35}img{display:block;max-width:100%;height:auto;margin:18px auto}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #ccd0d4;padding:8px}pre{white-space:pre-wrap}a{color:#176b87}blockquote{margin-left:0;padding-left:18px;border-left:3px solid #ccd0d4}</style></head><body><main><h1>${escape(name)}</h1>${source ? `<p><a href="${escape(source)}" target="_blank" rel="noreferrer">${escape(source)}</a></p>` : ""}${content}</main></body></html>`;
  return { buffer: Buffer.from(output), imageCount: images.size, imageBytes };
}
