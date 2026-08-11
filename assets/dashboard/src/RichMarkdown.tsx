import { useMemo } from "react";
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
};

export default function RichMarkdown({ content, imageUrls, imageFallback }: RichMarkdownProps) {
  const normalized = useMemo(
    () => content.replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_match, target, label) => label || target),
    [content]
  );

  return (
    <div className="document-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, rehypeSanitize, rehypeKatex]}
        components={{
          a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
          table: ({ children }) => <div className="document-table-scroll"><table>{children}</table></div>,
          img: ({ src, alt }) => {
            if (!src) return null;
            const resolved = imageUrls[src] ?? (isLocalMarkdownImageSource(src) ? "" : src);
            if (!resolved) return <span className="document-image-error">{imageFallback}: {alt || src}</span>;
            return <img src={resolved} alt={alt ?? ""} loading="lazy" />;
          }
        }}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
}

function isLocalMarkdownImageSource(source: string) {
  const value = source.trim();
  return Boolean(value) && !value.startsWith("#") && !value.startsWith("//") && !/^[a-z][a-z0-9+.-]*:/i.test(value);
}
