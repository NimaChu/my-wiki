import { useEffect, useRef, useState } from "react";
import { Crepe } from "@milkdown/crepe";
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
  const initialMarkdownRef = useRef(markdown);
  const callbacksRef = useRef({ onChange, onSave, onUploadImage, resolveImageUrl });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  callbacksRef.current = { onChange, onSave, onUploadImage, resolveImageUrl };

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let disposed = false;
    let userInteracted = false;
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
          ]
        }
      }
    });

    editor.on((listener) => {
      listener.markdownUpdated((_ctx, nextBody, previousBody) => {
        if (!userInteracted) {
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
        if (!userInteracted) return;
        callbacksRef.current.onSave(joinMarkdownFrontmatter(frontmatter.prefix, editor.getMarkdown()));
        return;
      }
      userInteracted = true;
    };
    const markInteraction = () => {
      userInteracted = true;
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
      root.removeEventListener("keydown", handleKeyDown);
      root.removeEventListener("beforeinput", markInteraction);
      root.removeEventListener("pointerdown", markInteraction);
      void editor.destroy();
    };
  }, []);

  return (
    <div className={`document-live-editor${ready ? " is-ready" : ""}`} aria-label={title}>
      {!ready && !error ? <div className="document-live-editor-loading">Loading editor...</div> : null}
      {error ? <p className="document-save-error" role="alert">{error}</p> : null}
      <div ref={rootRef} />
    </div>
  );
}
