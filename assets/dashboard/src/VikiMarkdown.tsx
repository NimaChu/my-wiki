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
        img: () => null
      }}
    >
      {pending ? stripDanglingSourceFootnotes(content) : content}
    </ReactMarkdown>
  );
}
