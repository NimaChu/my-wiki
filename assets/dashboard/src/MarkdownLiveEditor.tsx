import { useEffect, useRef, useState } from "react";
import { Crepe } from "@milkdown/crepe";
import { imageBlockSchema } from "@milkdown/kit/component/image-block";
import { commandsCtx } from "@milkdown/kit/core";
import { addBlockTypeCommand } from "@milkdown/kit/preset/commonmark";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame-dark.css";
import { joinMarkdownFrontmatter, splitMarkdownFrontmatter } from "./markdown-frontmatter.js";

type MarkdownLiveEditorProps = {
  markdown: string;
  title: string;
  placeholder: string;
  onChange: (markdown: string) => void;
  onSave: (markdown: string) => void;
  onUploadImage: (file: File) => Promise<string>;
  resolveImageUrl: (source: string) => Promise<string>;
};

export default function MarkdownLiveEditor({
  markdown,
  title,
  placeholder,
  onChange,
  onSave,
  onUploadImage,
  resolveImageUrl
}: MarkdownLiveEditorProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<Crepe | null>(null);
  const userInteractedRef = useRef(false);
  const initialMarkdownRef = useRef(markdown);
  const callbacksRef = useRef({ onChange, onSave, onUploadImage, resolveImageUrl });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  callbacksRef.current = { onChange, onSave, onUploadImage, resolveImageUrl };

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let disposed = false;
    let pristineBody = "";
    const frontmatter = splitMarkdownFrontmatter(initialMarkdownRef.current);
    const editor = new Crepe({
      root,
      defaultValue: frontmatter.body,
      features: {
        [Crepe.Feature.TopBar]: true,
        [Crepe.Feature.AI]: false
      },
      featureConfigs: {
        [Crepe.Feature.Placeholder]: {
          text: placeholder,
          mode: "block"
        },
        [Crepe.Feature.ImageBlock]: {
          onUpload: (file) => callbacksRef.current.onUploadImage(file),
          proxyDomURL: (source) => callbacksRef.current.resolveImageUrl(source)
        },
        [Crepe.Feature.Latex]: {
          katexOptions: { throwOnError: false }
        },
        [Crepe.Feature.TopBar]: {
          headingOptions: [
            { label: "Text", level: null },
            { label: "H1", level: 1 },
            { label: "H2", level: 2 },
            { label: "H3", level: 3 },
            { label: "H4", level: 4 }
          ],
          buildTopBar: (builder) => {
            const imageItem = builder.getGroup("insert").group.items.find((item) => item.key === "image");
            if (imageItem) imageItem.onRun = () => imageInputRef.current?.click();
          }
        }
      }
    });
    editorRef.current = editor;

    editor.on((listener) => {
      listener.markdownUpdated((_ctx, nextBody, previousBody) => {
        if (!userInteractedRef.current) {
          pristineBody = nextBody;
          return;
        }
        if (nextBody === previousBody || nextBody === pristineBody) return;
        callbacksRef.current.onChange(joinMarkdownFrontmatter(frontmatter.prefix, nextBody));
      });
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!userInteractedRef.current) return;
        callbacksRef.current.onSave(joinMarkdownFrontmatter(frontmatter.prefix, editor.getMarkdown()));
        return;
      }
      userInteractedRef.current = true;
    };
    const markInteraction = () => {
      userInteractedRef.current = true;
    };
    root.addEventListener("keydown", handleKeyDown);
    root.addEventListener("beforeinput", markInteraction);
    root.addEventListener("pointerdown", markInteraction);

    void editor.create()
      .then(() => {
        if (disposed) return;
        pristineBody = editor.getMarkdown();
        setReady(true);
      })
      .catch((reason) => {
        if (!disposed) setError(reason instanceof Error ? reason.message : String(reason));
      });

    return () => {
      disposed = true;
      editorRef.current = null;
      userInteractedRef.current = false;
      root.removeEventListener("keydown", handleKeyDown);
      root.removeEventListener("beforeinput", markInteraction);
      root.removeEventListener("pointerdown", markInteraction);
      void editor.destroy();
    };
  }, []);

  const insertImage = async (file: File) => {
    setError("");
    try {
      const source = await callbacksRef.current.onUploadImage(file);
      const editor = editorRef.current;
      if (!editor) throw new Error("The editor is not ready");
      userInteractedRef.current = true;
      editor.editor.action((ctx) => {
        ctx.get(commandsCtx).call(addBlockTypeCommand.key, {
          nodeType: imageBlockSchema.type(ctx),
          attrs: { src: source, alt: file.name.replace(/\.[^.]+$/, "") }
        });
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <div className={`document-live-editor${ready ? " is-ready" : ""}`} aria-label={title}>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void insertImage(file);
          event.currentTarget.value = "";
        }}
      />
      {!ready && !error ? <div className="document-live-editor-loading">Loading editor...</div> : null}
      {error ? <p className="document-save-error" role="alert">{error}</p> : null}
      <div ref={rootRef} />
    </div>
  );
}
