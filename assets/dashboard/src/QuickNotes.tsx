import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Check, FileArchive, FileText, Inbox, LoaderCircle, NotebookPen, Plus, Save, Trash2 } from "lucide-react";
import JSZip from "jszip";
import { LocalNoteSummary, MarkdownDocument, localApi } from "./api";

const MarkdownLiveEditor = lazy(() => import("./MarkdownLiveEditor"));

type Language = "en" | "zh";
type PendingAsset = { path: string; bytes: Uint8Array; type: string };

const copy = {
  en: {
    title: "Quick notes", newNote: "New note", localNotes: "Local notes", untitled: "Untitled note",
    titlePlaceholder: "Note title", editorPlaceholder: "Start writing...", importMarkdown: "Import Markdown",
    importZip: "Import ZIP bundle", save: "Save locally", saving: "Saving", saved: "Saved locally",
    capture: "Add to Inbox", capturing: "Adding", captured: "Added to Inbox; extraction is queued.",
    close: "Back to knowledge universe", empty: "No local notes yet", loadFailed: "Could not load the note",
    importFailed: "Could not import this file", imageFailed: "Could not add this image", dirty: "Unsaved changes",
    confirmClose: "This note has unsaved changes. Close it?", standardZip: "ZIP must contain one Markdown file and relative images.",
    delete: "Delete note", confirmDelete: "Delete \"{title}\" and its local note folder?", deleted: "Note deleted"
  },
  zh: {
    title: "快速笔记", newNote: "新建笔记", localNotes: "本地笔记", untitled: "未命名笔记",
    titlePlaceholder: "笔记标题", editorPlaceholder: "开始记录...", importMarkdown: "导入 Markdown",
    importZip: "导入 ZIP 图文包", save: "保存到本地", saving: "正在保存", saved: "已保存到本地",
    capture: "加入 Inbox", capturing: "正在加入", captured: "已加入 Inbox，等待提取。",
    close: "返回知识宇宙", empty: "还没有本地笔记", loadFailed: "无法读取这篇笔记",
    importFailed: "无法导入该文件", imageFailed: "无法添加图片", dirty: "有未保存修改",
    confirmClose: "当前笔记尚未保存，确定关闭吗？", standardZip: "ZIP 需包含一个 Markdown 文件及其相对路径图片。",
    delete: "删除笔记", confirmDelete: "确定删除“{title}”及其本地笔记文件夹吗？", deleted: "笔记已删除"
  }
} as const;

export function QuickNotes({ language, initialPath = "", onClose }: { language: Language; initialPath?: string; onClose: () => void }) {
  const l = copy[language];
  const [notes, setNotes] = useState<LocalNoteSummary[]>([]);
  const [document, setDocument] = useState<MarkdownDocument | null>(null);
  const [title, setTitle] = useState("");
  const [savedTitle, setSavedTitle] = useState("");
  const [draft, setDraft] = useState("");
  const [savedBody, setSavedBody] = useState("");
  const [pendingAssets, setPendingAssets] = useState<Map<string, PendingAsset>>(new Map());
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [deletingPath, setDeletingPath] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const markdownInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  const dirty = draft !== savedBody || title !== savedTitle || pendingAssets.size > 0 || (!document && Boolean(draft.trim() || title.trim()));
  const displayTitle = title.trim() || headingTitle(draft) || l.untitled;

  const refreshNotes = async () => setNotes((await localApi.notes()).notes);

  useEffect(() => {
    window.document.body.classList.add("has-markdown-workspace");
    void refreshNotes().catch((reason) => setError(errorText(reason)));
    return () => window.document.body.classList.remove("has-markdown-workspace");
  }, []);

  useEffect(() => () => {
    for (const url of Object.values(assetUrls)) URL.revokeObjectURL(url);
  }, [assetUrls]);

  const resetEditor = (next: { document?: MarkdownDocument | null; title?: string; markdown?: string; assets?: Map<string, PendingAsset> }) => {
    for (const url of Object.values(assetUrls)) URL.revokeObjectURL(url);
    const markdown = next.markdown ?? "";
    const assets = next.assets ?? new Map();
    setDocument(next.document ?? null);
    setTitle(next.title ?? "");
    setSavedTitle(next.document ? (next.title ?? "") : "");
    setDraft(markdown);
    setSavedBody(next.document ? markdown : "");
    setPendingAssets(assets);
    setAssetUrls(Object.fromEntries([...assets.values()].map((asset) => [asset.path, URL.createObjectURL(new Blob([asset.bytes], { type: asset.type }))])));
    setMessage("");
    setError("");
    setRevision((value) => value + 1);
  };

  const newNote = () => {
    if (dirty && !window.confirm(l.confirmClose)) return;
    resetEditor({ title: "", markdown: "" });
  };

  const openNote = async (note: LocalNoteSummary) => {
    if (dirty && !window.confirm(l.confirmClose)) return;
    setBusy(true);
    setError("");
    try {
      const next = await localApi.markdown(note.path);
      resetEditor({ document: next, title: next.title, markdown: next.body });
    } catch (reason) {
      setError(`${l.loadFailed}: ${errorText(reason)}`);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!initialPath) return;
    setBusy(true);
    setError("");
    localApi.markdown(initialPath)
      .then((next) => resetEditor({ document: next, title: next.title, markdown: next.body }))
      .catch((reason) => setError(`${l.loadFailed}: ${errorText(reason)}`))
      .finally(() => setBusy(false));
  }, [initialPath]);

  const importMarkdown = async (file: File) => {
    try {
      const markdown = await file.text();
      resetEditor({ title: headingTitle(markdown) || stripExtension(file.name), markdown });
    } catch (reason) {
      setError(`${l.importFailed}: ${errorText(reason)}`);
    }
  };

  const importZip = async (file: File) => {
    setBusy(true);
    setError("");
    try {
      const imported = await readStandardNoteZip(file);
      resetEditor({ title: headingTitle(imported.markdown) || stripExtension(file.name), markdown: imported.markdown, assets: imported.assets });
    } catch (reason) {
      setError(`${l.importFailed}: ${errorText(reason)} ${l.standardZip}`);
    } finally {
      setBusy(false);
    }
  };

  const uploadImage = async (file: File) => {
    if (document && pendingAssets.size === 0) {
      try {
        return (await localApi.uploadMarkdownImage(document.path, file)).source;
      } catch (reason) {
        setError(`${l.imageFailed}: ${errorText(reason)}`);
        throw reason;
      }
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const path = uniqueAssetPath(file.name || "image.png", pendingAssets);
    const asset = { path, bytes, type: file.type || imageType(path) };
    setPendingAssets((current) => new Map(current).set(path, asset));
    setAssetUrls((current) => ({ ...current, [path]: URL.createObjectURL(new Blob([bytes], { type: asset.type })) }));
    return path;
  };

  const save = async (body = draft) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const markdown = applyTitle(body, displayTitle);
      let next;
      if (document && pendingAssets.size === 0) {
        next = await localApi.saveMarkdown(document.path, markdown, document.version);
      } else {
        const zip = new JSZip();
        zip.file("note.md", markdown);
        for (const asset of pendingAssets.values()) zip.file(asset.path, asset.bytes);
        const bundle = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
        next = await localApi.saveNoteBundle(displayTitle, bundle, document?.path || "");
      }
      setDocument(next);
      setTitle(next.title || displayTitle);
      setSavedTitle(next.title || displayTitle);
      setDraft(next.body);
      setSavedBody(next.body);
      setPendingAssets(new Map());
      setMessage(l.saved);
      setRevision((value) => value + 1);
      await refreshNotes();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const capture = async () => {
    if (!document || dirty || capturing) return;
    setCapturing(true);
    setError("");
    try {
      await localApi.captureNote({ path: document.path, title: displayTitle });
      setMessage(l.captured);
      window.dispatchEvent(new Event("my-wiki:graph-updated"));
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setCapturing(false);
    }
  };

  const removeNote = async (note: LocalNoteSummary) => {
    if (deletingPath || !window.confirm(l.confirmDelete.replace("{title}", note.title))) return;
    setDeletingPath(note.path);
    setError("");
    try {
      await localApi.deleteNote(note.path);
      setNotes((current) => current.filter((item) => item.path !== note.path));
      if (document?.path === note.path) resetEditor({ title: "", markdown: "" });
      setMessage(l.deleted);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setDeletingPath("");
    }
  };

  const close = () => {
    if (dirty && !window.confirm(l.confirmClose)) return;
    onClose();
  };

  const sortedNotes = useMemo(() => notes, [notes]);
  return createPortal((
    <section className="quick-notes" role="dialog" aria-modal="true" aria-label={l.title}>
      <header className="quick-notes-header">
        <button className="document-icon-button" type="button" onClick={close} title={l.close} aria-label={l.close}><ArrowLeft size={18} /></button>
        <NotebookPen size={19} aria-hidden="true" />
        <strong>{l.title}</strong>
        <input aria-label={l.titlePlaceholder} value={title} onChange={(event) => { setTitle(event.target.value); setMessage(""); }} placeholder={l.titlePlaceholder} />
        <input ref={markdownInput} type="file" accept=".md,.markdown,text/markdown,text/plain" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importMarkdown(file); event.currentTarget.value = ""; }} />
        <input ref={zipInput} type="file" accept=".zip,application/zip" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importZip(file); event.currentTarget.value = ""; }} />
        <button type="button" onClick={() => markdownInput.current?.click()}><FileText size={16} />{l.importMarkdown}</button>
        <button type="button" onClick={() => zipInput.current?.click()}><FileArchive size={16} />{l.importZip}</button>
        <button className="document-save-button" type="button" disabled={busy || !dirty} onClick={() => void save()}>{busy ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}{busy ? l.saving : l.save}</button>
        <button className="quick-note-capture" type="button" disabled={!document || dirty || capturing} onClick={() => void capture()}>{capturing ? <LoaderCircle className="spin" size={16} /> : <Inbox size={16} />}{capturing ? l.capturing : l.capture}</button>
      </header>
      <main className="quick-notes-main">
        <aside className="quick-notes-list">
          <div className="quick-notes-list-header"><strong>{l.localNotes}</strong><button type="button" onClick={newNote} title={l.newNote} aria-label={l.newNote}><Plus size={16} /></button></div>
          {sortedNotes.length === 0 ? <p>{l.empty}</p> : sortedNotes.map((note) => (
            <div className={`quick-note-list-item${note.path === document?.path ? " is-active" : ""}`} key={note.path}>
              <button className="quick-note-list-open" type="button" onClick={() => void openNote(note)}>
                <strong>{note.title}</strong><span>{new Date(note.updatedAt).toLocaleString(language === "zh" ? "zh-CN" : "en")}</span>
              </button>
              <button className="quick-note-list-delete" type="button" disabled={deletingPath === note.path} onClick={() => void removeNote(note)} title={l.delete} aria-label={`${l.delete}: ${note.title}`}>
                {deletingPath === note.path ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />}
              </button>
            </div>
          ))}
        </aside>
        <section className="quick-note-editor">
          <Suspense fallback={<div className="document-state"><LoaderCircle className="spin" size={24} /></div>}>
            <MarkdownLiveEditor
              key={`${document?.path || "new"}-${revision}`}
              markdown={draft}
              title={displayTitle}
              placeholder={l.editorPlaceholder}
              onChange={(next) => { setDraft(next); setMessage(""); }}
              onSave={(next) => void save(next)}
              onUploadImage={uploadImage}
              resolveImageUrl={(source) => assetUrls[source] ? Promise.resolve(assetUrls[source]) : document ? localApi.markdownImageUrl(document.path, source) : Promise.reject(new Error(l.imageFailed))}
            />
          </Suspense>
          <footer><span>{dirty ? l.dirty : document ? document.path : l.newNote}</span>{message ? <span className="is-success"><Check size={14} />{message}</span> : null}</footer>
          {error ? <p className="document-save-error" role="alert">{error}</p> : null}
        </section>
      </main>
    </section>
  ), window.document.body);
}

async function readStandardNoteZip(file: File) {
  const zip = await JSZip.loadAsync(file);
  const files = Object.values(zip.files).filter((entry) => !entry.dir && !ignoredZipPath(entry.name));
  const markdownFiles = files.filter((entry) => /\.(?:md|markdown)$/i.test(entry.name));
  if (markdownFiles.length !== 1) throw new Error("The package must contain exactly one Markdown file");
  const markdownEntry = markdownFiles[0];
  const markdownDirectory = markdownEntry.name.includes("/") ? markdownEntry.name.slice(0, markdownEntry.name.lastIndexOf("/") + 1) : "";
  let markdown = await markdownEntry.async("string");
  const assets = new Map<string, PendingAsset>();
  const replacements = new Map<string, string>();
  for (const entry of files.filter((candidate) => isImage(candidate.name))) {
    const relative = relativeArchivePath(markdownDirectory, entry.name);
    if (!relative || relative.startsWith("../")) continue;
    const target = uniqueAssetPath(entry.name.split("/").pop() || "image.png", assets);
    const bytes = await entry.async("uint8array");
    assets.set(target, { path: target, bytes, type: imageType(target) });
    replacements.set(relative, target);
    replacements.set(`./${relative}`, target);
  }
  markdown = rewriteMarkdownImages(markdown, replacements);
  return { markdown, assets };
}

function rewriteMarkdownImages(markdown: string, replacements: Map<string, string>) {
  return markdown.replace(/(!\[[^\]]*\]\(\s*<?)([^\s)>]+)(>?[^)]*\))/g, (whole, before, source, after) => {
    const decoded = safeDecode(source);
    return replacements.has(decoded) ? `${before}${replacements.get(decoded)}${after}` : whole;
  });
}

function uniqueAssetPath(filename: string, assets: Map<string, unknown>) {
  const cleaned = filename.normalize("NFKC").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^\.+/, "") || "image.png";
  const extension = cleaned.match(/\.[^.]+$/)?.[0] || ".png";
  const stem = cleaned.slice(0, -extension.length) || "image";
  let candidate = `assets/${stem}${extension.toLowerCase()}`;
  for (let index = 2; assets.has(candidate); index += 1) candidate = `assets/${stem}-${index}${extension.toLowerCase()}`;
  return candidate;
}

function applyTitle(markdown: string, title: string) {
  const body = String(markdown || "").trim();
  if (/^#\s+.+$/m.test(body)) return `${body.replace(/^#\s+.+$/m, `# ${title}`)}\n`;
  return `# ${title}\n\n${body}${body ? "\n" : ""}`;
}

function headingTitle(markdown: string) { return String(markdown || "").match(/^#\s+(.+)$/m)?.[1]?.trim() || ""; }
function stripExtension(value: string) { return value.replace(/\.(?:md|markdown|zip)$/i, ""); }
function ignoredZipPath(value: string) { return value.split("/").some((part) => part === "__MACOSX" || part.startsWith(".")); }
function isImage(value: string) { return /\.(?:png|jpe?g|gif|webp|svg)$/i.test(value); }
function imageType(value: string) { const ext = value.split(".").pop()?.toLowerCase(); return ext === "svg" ? "image/svg+xml" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext || "png"}`; }
function safeDecode(value: string) { try { return decodeURIComponent(value); } catch { return value; } }
function relativeArchivePath(from: string, to: string) {
  const fromParts = from.split("/").filter(Boolean);
  const toParts = to.split("/").filter(Boolean);
  while (fromParts.length && toParts.length && fromParts[0] === toParts[0]) { fromParts.shift(); toParts.shift(); }
  return `${"../".repeat(fromParts.length)}${toParts.join("/")}`;
}
function errorText(value: unknown) { return value instanceof Error ? value.message : String(value); }
