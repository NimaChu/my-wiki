import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Download, LoaderCircle, X } from "lucide-react";
import { localApi } from "./api";
import { LibraryIconButton } from "./LibraryIconButton";
import RichMarkdown from "./RichMarkdown";
import type { DocumentLink } from "./markdown-rendering";
import "./originals-drive.css";

type Source = DocumentLink & { modified?: string };

export default function DocumentPreview({ source: initialSource, zh, onClose, onDownload }: { source: Source; zh: boolean; onClose: () => void; onDownload?: () => void }) {
  const [history, setHistory] = useState<Source[]>([initialSource]);
  const source = history[history.length - 1];
  useEffect(() => { setHistory([initialSource]); }, [initialSource.path, initialSource.kind, initialSource.modified, initialSource.anchor]);
  const name = source.kind === "original" ? source.name : source.path.split("/").pop() || source.path;
  const extension = name.split(".").pop()?.toLowerCase() || "";
  const kind = source.kind === "note" || /^(md|markdown|txt)$/.test(extension) ? "markdown" : /^(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/.test(extension) ? "image" : /^(pdf|html|htm)$/.test(extension) ? "browser" : "unsupported";
  const [reader, setReader] = useState<{ url: string; body: string; imageBase: string; title: string } | null>(null);
  const [error, setError] = useState("");
  const closeButton = useRef<HTMLButtonElement>(null);
  const title = useId();
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    document.body.classList.add("has-document-preview");
    closeButton.current?.focus();
    return () => { document.body.classList.remove("has-document-preview"); previousFocus?.focus(); };
  }, []);
  useEffect(() => {
    setReader(null); setError("");
    if (kind === "unsupported") return;
    const controller = new AbortController();
    const load = async () => {
      if (kind === "markdown") {
        const original = source.kind === "original";
        const document = original ? await localApi.originalMarkdown(source.path, controller.signal) : await localApi.markdown(source.path, controller.signal);
        const imageBase = await localApi.downloadUrl(`/api/v1/${original ? "drive/" : ""}markdown-image?${new URLSearchParams({ note: document.path })}`);
        if (!controller.signal.aborted) setReader({ url: "", body: document.body, imageBase, title: original ? name : document.title });
      } else {
        const url = await localApi.downloadUrl(`/api/v1/drive/read?${new URLSearchParams({ path: source.path })}`);
        if (!controller.signal.aborted) setReader({ url, body: "", imageBase: "", title: name });
      }
    };
    void load().catch(error => { if (!controller.signal.aborted) setError(String(error.message || error)); });
    return () => controller.abort();
  }, [source.path, source.kind, source.kind === "original" ? source.modified : "", kind, name]);
  return createPortal(<div className="drive-form-backdrop document-preview-overlay" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="library-preview" role="dialog" aria-modal="true" aria-labelledby={title} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
      <header>{history.length > 1 ? <LibraryIconButton className="icon-button" title={zh ? "返回上篇文档" : "Previous document"} onClick={() => setHistory(items => items.slice(0, -1))}><ArrowLeft size={18} /></LibraryIconButton> : null}<h3 id={title}>{reader?.title || name}</h3>{onDownload && history.length === 1 ? <LibraryIconButton className="icon-button" title={zh ? "下载原件" : "Download original"} aria-label={zh ? "下载预览原件" : "Download previewed original"} onClick={onDownload}><Download size={18} /></LibraryIconButton> : null}<button ref={closeButton} className="icon-button" aria-label={zh ? "关闭预览" : "Close preview"} onClick={onClose}><X size={18} /></button></header>
      <div className={`library-preview-content is-${kind}`}>
        {error ? <p role="alert">{error}</p> : kind === "unsupported" ? <p>{zh ? "此类型不支持浏览器阅读，可下载原件查看。" : "This file type cannot be read in the browser. Download the original to view it."}</p> : !reader ? <LoaderCircle className="spin" aria-label={zh ? "正在读取原件" : "Loading original"} /> : kind === "markdown" ?
          <RichMarkdown key={source.path} content={reader.body} documentPath={source.path} initialAnchor={source.anchor} onOpenDocument={next => setHistory(items => [...items, next])} imageUrls={{}} resolveImageUrl={value => `${reader.imageBase}&src=${encodeURIComponent(value)}`} imageFallback={zh ? "图片无法显示" : "Image unavailable"} renderingLabel={zh ? "正在渲染" : "Rendering"} renderMoreLabel={zh ? "加载更多" : "Load more"} /> : kind === "image" ?
          <img src={reader.url} alt={name} onError={() => setError(zh ? "无法读取图片" : "Unable to read image")} /> :
          <iframe title={name} src={reader.url} sandbox={/^(html|htm)$/.test(extension) ? "" : undefined} referrerPolicy="no-referrer" />}
      </div>
    </section>
  </div>, document.body);
}
