import { LibraryIconButton } from "./LibraryIconButton";
import { useEffect, useId, useRef, useState } from "react";
import { Archive, Download, History, Link, LoaderCircle, RotateCcw, Search, Upload, X } from "lucide-react";
import { DocumentVersion, DriveOriginal, Job, localApi, waitForJob } from "./api";

type Props = { mode: "update" | "history"; original?: DriveOriginal; language: "zh" | "en"; onClose: () => void; onUpdated: () => void };
export function DocumentVersions({ mode, original, language, onClose, onUpdated }: Props) {
  const zh = language === "zh";
  const id = useId();
  const picker = useRef<HTMLInputElement>(null);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [current, setCurrent] = useState<DocumentVersion | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [updateMode, setUpdateMode] = useState<"file" | "url">("file");
  const [url, setUrl] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(mode === "history");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [queued, setQueued] = useState(false);
  const title = mode === "update" ? (zh ? "更新文件版本" : "Update document version") : original ? (zh ? "历史版本" : "Version history") : (zh ? "历史文档库" : "Document history");
  const extension = (value: string) => value.includes(".") ? "." + value.split(".").pop()!.toLowerCase() : "";
  const supportsUrl = Boolean(original && /\.html?$/i.test(original.name));
  useEffect(() => {
    if (mode !== "history") return;
    let cancelled = false;
    localApi.documentVersions(original?.path).then((data) => { if (!cancelled) { setVersions(data.versions); setCurrent(data.current); } }).catch((e) => { if (!cancelled) setError(e.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [mode, original?.path]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); if (!busy) onClose(); } };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [busy, onClose]);
  const track = (job: Job) => {
    setQueued(true);
    onUpdated();
    void waitForJob(job).finally(() => {
      window.dispatchEvent(new Event("my-wiki:graph-updated"));
      window.dispatchEvent(new Event("my-wiki:drive-updated"));
    }).catch(() => {});
  };
  const update = async () => {
    if (!original || busy || (updateMode === "file" ? !file : !url.trim())) return;
    if (updateMode === "file" && file && extension(file.name) !== extension(original.name)) { setError(zh ? "新文件必须与原文件类型一致。" : "The new file must have the same file type."); return; }
    setBusy(true); setError("");
    try {
      track(updateMode === "url"
        ? await localApi.updateDocumentFromUrl(original.path, url.trim())
        : await localApi.captureFile(file!, { versionPath: original.path, title: original.references[0]?.title || original.name }, (value, total) => setProgress(Math.round(value / total * 100))));
    }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const restore = async (version: DocumentVersion) => {
    const effect = version.reusable ? (zh ? "复用已提取、修复的证据，重新进入待蒸馏。" : "Reuse the extracted evidence and queue distillation again.") : (zh ? "此版本提取或修复未完成，将重新提取并检查质量。" : "This version has incomplete evidence and will be extracted and checked again.");
    if (!window.confirm(zh ? `以 v${version.number} 创建一个新版本？当前版本将归档。${effect}` : `Create a new version from v${version.number}? The current version will be archived. ${effect}`)) return;
    setBusy(true); setError("");
    try { track(await localApi.restoreDocumentVersion(version.original, version.id)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const download = async (version: DocumentVersion, bundle = false) => {
    try {
      const url = await localApi.downloadUrl(`/api/v1/drive/versions/${bundle ? "archive" : "download"}?${new URLSearchParams({ path: version.original, id: version.id })}`);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = bundle ? `v${version.number}-evidence.zip` : version.filename; anchor.click();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return <div className="drive-form-backdrop">
    <section className="document-versions" role="dialog" aria-modal="true" aria-labelledby={id}>
      <header><History size={19} /><h3 id={id}>{title}</h3><LibraryIconButton autoFocus className="icon-button" disabled={busy} aria-label={zh ? "关闭版本窗口" : "Close versions"} onClick={onClose}><X size={18} /></LibraryIconButton></header>
      {original ? <p className="version-document-name">{original.name}{current ? ` · v${current.number}` : ""}</p> : null}
      {queued ? <div className="version-queued" role="status"><strong>{zh ? "已进入维护队列" : "Added to maintenance queue"}</strong><button className="primary-button" onClick={onClose}>{zh ? "完成" : "Done"}</button></div> : mode === "update" ? <form onSubmit={(e) => { e.preventDefault(); void update(); }}>
        <p>{zh ? "当前原件、提取正文和附件会先保存到历史文档库。新文件将自动提取，再按质量进入待修复或待蒸馏。" : "The current original, extracted text and attachments will be archived. The new file will be extracted, then queued for repair or distillation."}</p>
        {original && original.references.length > 1 ? <p>{zh ? `该原件关联 ${original.references.length} 条参考资料，将一并更新。` : `This original is linked to ${original.references.length} References; all will be updated.`}</p> : null}
        {supportsUrl ? <div className="version-update-modes" role="group" aria-label={zh ? "更新方式" : "Update method"}>
          <button type="button" aria-pressed={updateMode === "file"} disabled={busy} onClick={() => { setUpdateMode("file"); setError(""); }}><Upload size={16} />{zh ? "上传文件" : "Upload file"}</button>
          <button type="button" aria-pressed={updateMode === "url"} disabled={busy} onClick={() => { setUpdateMode("url"); setError(""); }}><Link size={16} />{zh ? "网址链接" : "Webpage URL"}</button>
        </div> : null}
        {updateMode === "url" ? <label className="version-url"><span>{zh ? "网页地址" : "Webpage address"}</span><input type="url" required pattern="https?://.*" aria-label={zh ? "网页地址" : "Webpage address"} placeholder="https://" disabled={busy} value={url} onChange={(event) => { setUrl(event.target.value); setError(""); }} /></label> : <button className="file-drop" type="button" disabled={busy} onClick={() => picker.current?.click()}><Upload size={24} /><strong>{file?.name || (zh ? "选择更新后的文件" : "Choose the updated file")}</strong><span>{original ? extension(original.name).toUpperCase() : ""}</span></button>}
        <input hidden ref={picker} type="file" accept={original ? extension(original.name) : undefined} onChange={(e) => {
          const selected = e.target.files?.[0] || null;
          setError("");
          if (selected && original && extension(selected.name) !== extension(original.name)) { setError(zh ? "新文件必须与原文件类型一致。" : "The file type must match."); setFile(null); }
          else setFile(selected);
        }} />
        {busy ? <div role="status" className="version-progress"><LoaderCircle className="spin" size={16} />{updateMode === "url" ? (zh ? "正在提交" : "Submitting") : <>{zh ? "正在上传" : "Uploading"} {progress ?? 0}%<progress max="100" value={progress ?? 0} /></>}</div> : null}
        <footer><button type="button" disabled={busy} onClick={onClose}>{zh ? "取消" : "Cancel"}</button><button type="submit" className="primary-button" disabled={busy || (updateMode === "url" ? !url.trim() : !file)}><Upload size={16} />{zh ? "确认更新" : "Confirm update"}</button></footer>
      </form> : <>
        <label className="drive-search version-search"><Search size={15} /><input aria-label={zh ? "搜索历史文档" : "Search document history"} placeholder={zh ? "搜索历史文档" : "Search document history"} value={query} onChange={(e) => setQuery(e.target.value)} /></label>
        <div className="version-list" aria-busy={loading}>
          {loading ? <LoaderCircle className="spin" aria-label={zh ? "正在读取历史版本" : "Loading version history"} /> : versions.length === 0 ? <p>{zh ? "暂无历史版本" : "No historical versions"}</p> : null}
          {versions.filter((version) => `${version.filename} ${version.original}`.toLowerCase().includes(query.toLowerCase())).map((version) => <article className="version-row" key={version.id}>
            <div><strong>{version.filename} <span>v{version.number}</span></strong><small>{new Date(version.archivedAt).toLocaleString(language)} · {version.referenceCount} {zh ? "条参考资料" : "References"} · {(version.bytes / 1048576).toFixed(1)} MB</small><span>{version.reusable ? (zh ? "可复用提取结果 · 恢复后待蒸馏" : "Evidence reusable · distillation required") : (zh ? "提取或修复尚未完成" : "Extraction or repair incomplete")}</span></div>
            <div className="version-actions">
              <LibraryIconButton className="icon-button" disabled={busy} aria-label={zh ? `下载原件 v${version.number}` : `Download original v${version.number}`} title={zh ? "下载历史原件" : "Download historical original"} onClick={() => void download(version)}><Download size={17} /></LibraryIconButton>
              <LibraryIconButton className="icon-button" disabled={busy} aria-label={zh ? `下载证据包 v${version.number}` : `Download evidence bundle v${version.number}`} title={zh ? "下载完整历史证据" : "Download all historical evidence"} onClick={() => void download(version, true)}><Archive size={17} /></LibraryIconButton>
              <LibraryIconButton className="icon-button" disabled={busy} aria-label={zh ? `恢复 v${version.number} 为新版本` : `Restore v${version.number} as new version`} title={zh ? "恢复为新版本" : "Restore as a new version"} onClick={() => void restore(version)}>{busy ? <LoaderCircle className="spin" size={17} /> : <RotateCcw size={17} />}</LibraryIconButton>
            </div>
          </article>)}
        </div>
      </>}
      {error ? <p role="alert" className="drive-error">{error}</p> : null}
    </section>
  </div>;
}
