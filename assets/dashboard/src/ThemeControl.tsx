import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import "./theme.css";

type Mode = "system" | "light" | "dark";
const storageKey = "my-wiki-theme";
function savedMode(): Mode {
  try { const value = localStorage.getItem(storageKey); if (value === "light" || value === "dark") return value; } catch {}
  return "system";
}

export function ThemeControl({ language }: { language: "zh" | "en" }) {
  const [mode, setMode] = useState<Mode>(savedMode);
  const [systemDark, setSystemDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    const sync = (event: StorageEvent) => { if (event.key === storageKey || event.key === null) setMode(savedMode()); };
    media.addEventListener("change", update); window.addEventListener("storage", sync);
    return () => { media.removeEventListener("change", update); window.removeEventListener("storage", sync); };
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = mode === "system" ? (systemDark ? "dark" : "light") : mode; }, [mode, systemDark]);
  const options = [{ value: "system" as const, Icon: Monitor, label: language === "zh" ? "跟随系统" : "System" }, { value: "light" as const, Icon: Sun, label: language === "zh" ? "浅色" : "Light" }, { value: "dark" as const, Icon: Moon, label: language === "zh" ? "深色" : "Dark" }];
  return <div className="settings-appearance" role="group" aria-label={language === "zh" ? "外观" : "Appearance"}>
    <span>{language === "zh" ? "外观" : "Appearance"}</span>
    <div className="settings-theme-options">{options.map(({ value, Icon, label }) => <button type="button" key={value} aria-pressed={mode === value} title={label} onClick={() => { setMode(value); try { localStorage.setItem(storageKey, value); } catch {} }}><Icon size={16} /><span>{label}</span></button>)}</div>
  </div>;
}
