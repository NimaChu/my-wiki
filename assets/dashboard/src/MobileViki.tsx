import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Viki } from "./Viki";

const DocumentPreview = lazy(() => import("./DocumentPreview"));
const mobileChatQuery = "(max-width: 760px), (hover: none) and (pointer: coarse)";

export function useMobileChat() {
  const [mobile, setMobile] = useState(() => window.matchMedia(mobileChatQuery).matches);
  useEffect(() => {
    const media = window.matchMedia(mobileChatQuery);
    const update = () => setMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return mobile;
}

export function MobileViki({ language }: { language: "zh" | "en" }) {
  const [documentPath, setDocumentPath] = useState<string | null>(null);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    document.body.classList.add("has-mobile-chat");
    const viewport = window.visualViewport;
    // Mobile keyboards resize the visual viewport, not always the layout viewport.
    const update = () => {
      if (!root.current || !viewport || viewport.scale !== 1) return;
      root.current.style.setProperty("--chat-height", `${viewport.height}px`);
      root.current.style.setProperty("--chat-top", `${viewport.offsetTop}px`);
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    return () => {
      document.body.classList.remove("has-mobile-chat");
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
    };
  }, [language]);
  return <main className="mobile-chat-root" ref={root}>
    <Viki language={language} standalone onOpenDocument={setDocumentPath} />
    {documentPath ? <Suspense fallback={null}>
      <DocumentPreview source={{ kind: "note", path: documentPath }} zh={language === "zh"} onClose={() => setDocumentPath(null)} />
    </Suspense> : null}
  </main>;
}
