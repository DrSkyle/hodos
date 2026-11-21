export type ThemeMode = "auto" | "light" | "dark";

const STORAGE_KEY = "hodos.theme";
const LIGHT_META = "#fdf1f3";
const DARK_META = "#141314";

const SUN =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4"/></svg>';
const MOON =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.3A8.5 8.5 0 0 1 9.7 3.5a8.5 8.5 0 1 0 10.8 10.8z"/></svg>';

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
  if (typeof document !== "undefined" && document.body?.classList.contains("hodos-v2")) {
    return false;
  }
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

function syncButton(btn: HTMLButtonElement, mode: ThemeMode): void {
  const isDark = resolveDark(mode);
  btn.innerHTML = isDark ? SUN : MOON;
  btn.setAttribute("aria-pressed", String(isDark));
  btn.setAttribute("aria-label", isDark ? "Switch to light theme" : "Switch to dark theme");
  btn.title = isDark ? "Switch to light theme" : "Switch to dark theme";
}

export function wireThemeToggle(buttonId = "theme-toggle"): void {
  let mode = getSavedTheme();
  applyTheme(mode);

  const btn = document.getElementById(buttonId) as HTMLButtonElement | null;
  if (!btn) return;
  syncButton(btn, mode);

  btn.addEventListener("click", () => {
    mode = resolveDark(mode) ? "light" : "dark";
    applyTheme(mode);
    syncButton(btn, mode);
  });

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (mode === "auto") {
      applyTheme("auto");
      syncButton(btn, mode);
    }
  });
}
