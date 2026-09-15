import { Children, isValidElement, useMemo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { stripDanglingSourceFootnotes } from "./answer-markdown.js";
import "katex/dist/katex.min.css";

export default function VikiMarkdown({ content, pending = false }: { content: string; pending?: boolean }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        a: ({ href, children }) => pending ? <span>{children}</span> : <a href={href} target="_blank" rel="noreferrer">{children}</a>,
        table: ({ children }) => <div className="viki-table-scroll"><table>{children}</table></div>,
        pre: ({ children }) => {
          const childItems = Children.toArray(children);
          const child = childItems.length === 1 ? childItems[0] : null;
          const source = isValidElement<{ className?: string; children?: ReactNode }>(child)
            ? textContent(child.props.children).replace(/\n$/, "") : "";
          if (!pending && isValidElement<{ className?: string; children?: ReactNode }>(child)
            && /(?:^|\s)language-(?:svg|xml)(?:\s|$)/.test(child.props.className || "")
            && /^\s*(?:<\?xml[^>]*>\s*)?<svg\b/i.test(source)) {
            return <SafeSvgPreview source={source} />;
          }
          return <pre>{children}</pre>;
        },
        img: () => null
      }}
    >
      {pending ? stripDanglingSourceFootnotes(content) : content}
    </ReactMarkdown>
  );
}

function SafeSvgPreview({ source }: { source: string }) {
  const svg = useMemo(() => sanitizeSvg(source), [source]);
  if (!svg) return <pre><code className="language-svg">{source}</code></pre>;
  const ratio = svgAspectRatio(svg);
  const document = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'"><style>html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent}body{display:grid;place-items:center}svg{display:block;max-width:100%;max-height:100%;width:100%;height:auto}</style></head><body>${svg}</body></html>`;
  return <figure className="viki-svg-preview">
    <iframe title="SVG preview" sandbox="" srcDoc={document} style={{ aspectRatio: ratio }} />
    <details><summary>SVG source</summary><pre><code className="language-svg">{source}</code></pre></details>
  </figure>;
}

function sanitizeSvg(source: string) {
  if (source.length > 2 * 1024 * 1024 || typeof DOMParser === "undefined") return "";
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  if (parsed.querySelector("parsererror") || parsed.documentElement.localName.toLowerCase() !== "svg") return "";
  const root = parsed.documentElement;
  for (const element of [...root.querySelectorAll("script,foreignObject,iframe,object,embed,link,meta,base,form,input,button,textarea,select")]) element.remove();
  for (const element of [root, ...root.querySelectorAll("*")]) {
    if (element.localName.toLowerCase() === "style" && unsafeCss(element.textContent || "")) {
      element.remove();
      continue;
    }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith("on") || /javascript\s*:/i.test(value) || (name === "style" && unsafeCss(value))) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (["href", "xlink:href", "src"].includes(name)
        && !value.startsWith("#")
        && !/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(value)) element.removeAttribute(attribute.name);
    }
  }
  return new XMLSerializer().serializeToString(root);
}

function unsafeCss(value: string) {
  return /@import|expression\s*\(|javascript\s*:|url\s*\(\s*(?!["']?#)/i.test(value);
}

function svgAspectRatio(svg: string) {
  const viewBox = svg.match(/\bviewBox=["']\s*[-+\d.e]+\s+[-+\d.e]+\s+([-+\d.e]+)\s+([-+\d.e]+)\s*["']/i);
  const width = Number(viewBox?.[1]);
  const height = Number(viewBox?.[2]);
  const ratio = width > 0 && height > 0 ? width / height : 16 / 9;
  return String(Math.max(0.5, Math.min(3, ratio)));
}

function textContent(value: ReactNode): string {
  return Children.toArray(value).map((item) => typeof item === "string" || typeof item === "number" ? String(item) : "").join("");
}
