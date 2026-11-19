export type ThemeMode = "auto" | "light" | "dark";

const STORAGE_KEY = "hodos.theme";
const LIGHT_META = "#faf8f2";
const DARK_META = "#141311";

export function getSavedTheme(): ThemeMode {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "auto") return v;
  } catch {
    // Ignore storage failures in restricted contexts.
  }
  return "auto";
}

export function resolveDark(mode: ThemeMode): boolean {
  if (mode === "dark") return true;
  if (mode === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === "auto") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", mode);
  }
  const isDark = resolveDark(mode);
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) {
    meta.content = isDark ? DARK_META : LIGHT_META;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Ignore storage failures.
  }
}

export function wireThemeToggle(buttonId = "theme-toggle"): void {
  let mode = getSavedTheme();
  applyTheme(mode);

  const btn = document.getElementById(buttonId) as HTMLButtonElement | null;
  const syncButton = () => {
    if (!btn) return;
    const isDark = resolveDark(mode);
    btn.setAttribute("aria-pressed", String(isDark));
    btn.title = `Theme: ${mode} (click to switch)`;
    btn.textContent = isDark ? "☀ Light" : "☾ Dark";
  };

  syncButton();

  btn?.addEventListener("click", () => {
    const currentlyDark = resolveDark(mode);
    mode = currentlyDark ? "light" : "dark";
    applyTheme(mode);
    syncButton();
  });

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (mode === "auto") {
      applyTheme("auto");
      syncButton();
    }
  });
}
