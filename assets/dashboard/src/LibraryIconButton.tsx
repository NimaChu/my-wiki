import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./library-tooltip.css";

export function LibraryTooltip({ label, children }: { label: string; children: ReactNode }) {
  const root = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const id = useId();
  const [position, setPosition] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const hide = () => { window.clearTimeout(timer.current); setPosition(null); };
  const show = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const rect = root.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition({ left: Math.max(104, Math.min(window.innerWidth - 104, rect.left + rect.width / 2)), top: rect.top < 48 ? rect.bottom + 8 : rect.top - 8, below: rect.top < 48 });
    }, 180);
  };
  useEffect(() => {
    if (!position) return;
    window.addEventListener("resize", hide);
    window.addEventListener("scroll", hide, true);
    return () => { window.removeEventListener("resize", hide); window.removeEventListener("scroll", hide, true); };
  }, [Boolean(position)]);
  useEffect(() => {
    return () => window.clearTimeout(timer.current);
  }, []);
  return <span ref={root} className="library-icon-control" onPointerEnter={show} onPointerLeave={hide} onFocus={show} onBlur={hide} onClick={hide} onKeyDown={(event) => { if (event.key === "Escape") hide(); }}>
    {children}
    {position ? createPortal(<span id={id} role="tooltip" className="library-tooltip" style={{ left: position.left, top: position.top, transform: position.below ? "translateX(-50%)" : "translate(-50%, -100%)" }}>{label}</span>, document.body) : null}
  </span>;
}

export function LibraryIconButton({ title, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const label = title || props["aria-label"] || "";
  return <LibraryTooltip label={label}><button type="button" {...props} aria-label={props["aria-label"] || label} /></LibraryTooltip>;
}
