import { lookup } from "node:dns";
import { Agent, fetch as fetchHttp } from "undici";
import ipaddr from "ipaddr.js";

export function isPublicAddress(address) {
  try { return ipaddr.process(address).range() === "unicast"; } catch { return false; }
}

export function validatePublicWebUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password
    || !["", "80", "443"].includes(url.port)) throw new Error("Only public HTTP(S) webpages are allowed");
  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (hostname === "localhost" || /\.(?:localhost|local|internal)$/.test(hostname)
    || (ipaddr.isValid(hostname) && !isPublicAddress(hostname))) throw new Error("Local/private addresses are not allowed");
  return url;
}

const dispatcher = new Agent({ connect: { lookup(host, options, callback) {
  lookup(host, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some((item) => !isPublicAddress(item.address))) return callback(new Error("Private addresses are not allowed"));
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
} } });

export async function fetchPublicWebResource(value, { signal, maxBytes, htmlOnly = false, imageOnly = false, fetcher = fetchHttp }) {
  let url = validatePublicWebUrl(value);
  for (let redirect = 0; redirect < 5; redirect++) {
    const response = await fetcher(url, { dispatcher, redirect: "manual", signal,
      headers: { "user-agent": "My-Wiki/1.0", accept: imageOnly ? "image/png,image/jpeg,image/gif,image/webp" : "text/html,text/plain,application/xhtml+xml" } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const target = response.headers.get("location");
      await response.body?.cancel();
      if (!target) throw new Error("Webpage redirect has no location");
      url = validatePublicWebUrl(new URL(target, url).href);
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Webpage HTTP ${response.status}`); }
    const contentType = response.headers.get("content-type") || "";
    const allowed = imageOnly ? /^image\/(?:png|jpe?g|gif|webp)(?:;|$)/i
      : htmlOnly ? /^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i : /text\/|application\/xhtml/;
    if (!allowed.test(contentType)) {
      await response.body?.cancel(); throw new Error(imageOnly ? "Unsupported offline image type" : htmlOnly ? "The URL must return an HTML webpage" : "Only readable webpages and text are supported");
    }
    if (Number(response.headers.get("content-length") || 0) > maxBytes) {
      await response.body?.cancel(); throw new Error("Webpage exceeds the size limit");
    }
    const bytes = [];
    let size = 0;
    for await (const chunk of response.body || []) {
      size += chunk.length;
      if (size > maxBytes) throw new Error("Webpage exceeds the size limit");
      bytes.push(chunk);
    }
    return { url: url.href, buffer: Buffer.concat(bytes), contentType };
  }
  throw new Error("Too many webpage redirects");
}
