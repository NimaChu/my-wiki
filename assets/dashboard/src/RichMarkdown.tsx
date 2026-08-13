import { memo, startTransition, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";

type RichMarkdownProps = {
  content: string;
  imageUrls: Record<string, string>;
  imageFallback: string;
  renderingLabel: string;
  renderMoreLabel: string;
};

const INITIAL_RENDER_CHUNKS = 2;
const RENDER_CHUNK_BATCH = 4;
const PAGED_DOCUMENT_THRESHOLD = 8;

export default function RichMarkdown({ content, imageUrls, imageFallback, renderingLabel, renderMoreLabel }: RichMarkdownProps) {
  const normalized = useMemo(
    () => content.replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_match, target, label) => label || target),
    [content]
  );
  const chunks = useMemo(() => markdownRenderChunks(normalized), [normalized]);
  const [renderedChunkCount, setRenderedChunkCount] = useState(() => initialChunkCount(chunks.length));
  const progressRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setRenderedChunkCount(initialChunkCount(chunks.length));
  }, [chunks]);

  const renderMore = () => {
    startTransition(() => {
      setRenderedChunkCount((current) => Math.min(chunks.length, current + RENDER_CHUNK_BATCH));
    });
  };

  useEffect(() => {
    const target = progressRef.current;
    if (!target || renderedChunkCount >= chunks.length || !("IntersectionObserver" in window)) return;
    const root = target.closest(".markdown-workspace-main");
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) renderMore();
      },
      { root, rootMargin: "700px 0px" }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [chunks.length, renderedChunkCount]);

  return (
    <div className="document-markdown">
      {chunks.slice(0, renderedChunkCount).map((chunk, index) => (
        <MarkdownChunk
          key={`${index}-${chunk.slice(0, 48)}`}
          content={chunk}
          imageUrls={imageUrls}
          imageFallback={imageFallback}
        />
      ))}
      {renderedChunkCount < chunks.length ? (
        <button
          ref={progressRef}
          className="document-render-progress"
          type="button"
          onClick={renderMore}
          aria-label={`${renderMoreLabel} ${renderedChunkCount}/${chunks.length}`}
        >
          <span className="document-render-progress-dot" aria-hidden="true" />
          <span aria-live="polite">{renderingLabel} {renderedChunkCount}/{chunks.length}</span>
          <strong>{renderMoreLabel}</strong>
        </button>
      ) : null}
    </div>
  );
}

const MarkdownChunk = memo(function MarkdownChunk({ content, imageUrls, imageFallback }: Omit<RichMarkdownProps, "renderingLabel" | "renderMoreLabel">) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeRaw, rehypeSanitize, rehypeKatex]}
      components={{
        a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
        table: ({ children }) => <div className="document-table-scroll"><table>{children}</table></div>,
        span: ({ className, title, children, ...props }) => {
          if (className?.includes("katex-error")) {
            return (
              <span className="document-formula-error" title={title}>
                <strong>公式语法错误 / Formula syntax error</strong>
                <code>{children}</code>
                {title ? <small>{title}</small> : null}
              </span>
            );
          }
          return <span className={className} title={title} {...props}>{children}</span>;
        },
        img: ({ src, alt }) => {
          if (!src) return null;
          const resolved = imageUrls[src] ?? (isLocalMarkdownImageSource(src) ? "" : src);
          if (!resolved) return <span className="document-image-error">{imageFallback}: {alt || src}</span>;
          return <img src={resolved} alt={alt ?? ""} loading="lazy" />;
        }
      }}
    >
      {content}
    </ReactMarkdown>
  );
});

function markdownRenderChunks(content: string) {
  const pageChunks = content.split(/(?=^### Page \d+\s*$)/gm).filter(Boolean);
  return pageChunks.length >= PAGED_DOCUMENT_THRESHOLD ? pageChunks : [content];
}

function initialChunkCount(total: number) {
  return Math.min(total, INITIAL_RENDER_CHUNKS);
}

function isLocalMarkdownImageSource(source: string) {
  const value = source.trim();
  return Boolean(value) && !value.startsWith("#") && !value.startsWith("//") && !/^[a-z][a-z0-9+.-]*:/i.test(value);
}
