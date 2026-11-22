import { useEffect, useState } from "react";
import { applyFontSize } from "./top-menu/TopMenu.jsx";

// Theme (auto | light | dark) and text size (S | M | L): one small store each, kept in localStorage when it is there and working
// without it (a private window, blocked site data). The shared theme tokens do the rest; this only sets data-theme on <html>.
const read = (key, ok, fallback) => {
  try { const v = localStorage.getItem(key); return ok(v) ? v : fallback; } catch { return fallback; }
};
const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* the choice lasts for this page only */ } };

export const THEMES = ["auto", "light", "dark"];
export const SIZES = ["S", "M", "L"];

export function useTheme() {
  const [theme, setTheme] = useState(() => read("pgc.theme", (v) => THEMES.includes(v), "auto"));
  const [fontSize, setFontSize] = useState(() => read("pgc.fontSize", (v) => SIZES.includes(v), "M"));
  useEffect(() => {
    if (theme === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    write("pgc.theme", theme);
  }, [theme]);
  useEffect(() => { applyFontSize(fontSize); write("pgc.fontSize", fontSize); }, [fontSize]);
  return { theme, setTheme, fontSize, setFontSize };
}
