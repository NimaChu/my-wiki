import { startTransition, useEffect, useId, useMemo, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { markdownRenderChunks, rehypeDocumentAnchors, remarkDocumentPage, resolveDocumentLink, type DocumentLink } from "./markdown-rendering";
import "katex/dist/katex.min.css";

type RichMarkdownProps = {
  content: string;
  imageUrls: Record<string, string>;
  imageFallback: string;
  renderingLabel: string;
  renderMoreLabel: string;
  renderAll?: boolean;
  resolveImageUrl?: (source: string) => string;
  documentPath?: string;
  initialAnchor?: string;
  onOpenDocument?: (source: DocumentLink) => void;
};

const INITIAL_RENDER_CHUNKS = 2;
const RENDER_CHUNK_BATCH = 4;
const MarkdownTable: Components["table"] = ({ children }) => <div className="document-table-scroll"><table>{children}</table></div>;
const MarkdownSpan: Components["span"] = ({ node: _node, className, title, children, ...props }) => className?.includes("katex-error")
  ? <span className="document-formula-error" title={title}><strong>公式语法错误 / Formula syntax error</strong><code>{children}</code>{title ? <small>{title}</small> : null}</span>
  : <span className={className} title={title} {...props}>{children}</span>;

export default function RichMarkdown({ content, imageUrls, imageFallback, renderingLabel, renderMoreLabel, renderAll = false, resolveImageUrl, documentPath = "", initialAnchor = "", onOpenDocument }: RichMarkdownProps) {
  const document = useMemo(() => markdownRenderChunks(content), [content]);
  const total = document.starts.length;
  const [renderedChunkCount, setRenderedChunkCount] = useState(() => renderAll || initialAnchor ? total : Math.min(total, INITIAL_RENDER_CHUNKS));
  const [pendingAnchor, setPendingAnchor] = useState("");
  const progressRef = useRef<HTMLButtonElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const prefix = `markdown-${useId().replace(/[^a-z\d_-]/gi, "")}-`;
  const anchors = useMemo(() => rehypeDocumentAnchors(prefix), [prefix]);
  const preparedPage = useMemo(() => remarkDocumentPage(document, renderedChunkCount), [document, renderedChunkCount]);
  const Anchor = useMemo<NonNullable<Components["a"]>>(() => ({ node: _node, href, children, ...props }) => {
    const internal = resolveDocumentLink(href || "", documentPath);
    const local = href?.startsWith("#") || Boolean(internal && onOpenDocument);
    return <a {...props} href={href} target={local ? undefined : "_blank"} rel={local ? undefined : "noreferrer"} onClick={event => {
      if (href?.startsWith("#")) {
        event.preventDefault();
        setRenderedChunkCount(total);
        setPendingAnchor(href.slice(1));
      } else if (internal && onOpenDocument) {
        event.preventDefault();
        onOpenDocument(internal);
      }
    }}>{children}</a>;
  }, [documentPath, onOpenDocument, total]);

  useEffect(() => {
    setRenderedChunkCount(renderAll || initialAnchor ? total : Math.min(total, INITIAL_RENDER_CHUNKS));
    setPendingAnchor(initialAnchor ? prefix + initialAnchor : "");
  }, [document, renderAll, initialAnchor, prefix, total]);

  useEffect(() => {
    if (!pendingAnchor) return;
    const target = Array.from(rootRef.current?.querySelectorAll<HTMLElement>("[id]") || []).find(node => node.id === pendingAnchor);
    if (!target) return;
    target.scrollIntoView({ block: "start" });
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
    setPendingAnchor("");
  }, [pendingAnchor, renderedChunkCount]);

  const renderMore = () => startTransition(() => setRenderedChunkCount(current => Math.min(total, current + RENDER_CHUNK_BATCH)));
  useEffect(() => {
    const target = progressRef.current;
    if (!target || renderedChunkCount >= total || !("IntersectionObserver" in window)) return;
    const root = target.closest(".markdown-workspace-main, .library-preview-content, .side-panel");
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) renderMore();
    }, { root, rootMargin: "700px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [total, renderedChunkCount]);

  return <div ref={rootRef} className="document-markdown">
    <ReactMarkdown
      remarkPlugins={[preparedPage]}
      remarkRehypeOptions={{ clobberPrefix: "" }}
      rehypePlugins={[rehypeRaw, rehypeSanitize, anchors, rehypeKatex]}
      components={{
        a: Anchor,
        table: MarkdownTable,
        span: MarkdownSpan,
        img: ({ src, alt }) => {
          if (!src) return null;
          const local = !src.startsWith("#") && !src.startsWith("//") && !/^[a-z][a-z\d+.-]*:/i.test(src);
          const resolved = imageUrls[src] ?? (local ? resolveImageUrl?.(src) || "" : src);
          return resolved ? <img src={resolved} alt={alt ?? ""} loading="lazy" /> : <span className="document-image-error">{imageFallback}: {alt || src}</span>;
        }
      }}
    >{content}</ReactMarkdown>
    {renderedChunkCount < total ? <button ref={progressRef} className="document-render-progress" type="button" onClick={renderMore} aria-label={`${renderMoreLabel} ${renderedChunkCount}/${total}`}>
      <span className="document-render-progress-dot" aria-hidden="true" /><span aria-live="polite">{renderingLabel} {renderedChunkCount}/{total}</span><strong>{renderMoreLabel}</strong>
    </button> : null}
  </div>;
}
