import "./landing.css";
import "./showcase.css";
const year = document.getElementById("year");
if (year) year.textContent = String(new Date().getFullYear());
// Retire the previous offline browser app and its cached resources.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((items) =>
    Promise.all(items.map((item) => item.unregister()))).catch(() => {});
}
if ("caches" in window) {
  caches.keys().then((keys) =>
    Promise.all(keys.filter((key) => key.startsWith("hodos-")).map((key) => caches.delete(key)))).catch(() => {});
}

/** Only show the creator's original high-resolution transparent wordmark.
 * Old thumbnail copies and broken assets must never replace the usable header.
 */
const originalLogo = document.querySelector<HTMLImageElement>("[data-brand-original]");
if (originalLogo) {
  const showOriginal = () => {
    if (originalLogo.naturalWidth >= 1200 && originalLogo.naturalHeight >= 500) {
      originalLogo.hidden = false;
      document.querySelector<HTMLElement>(".brand-fallback")?.setAttribute("hidden", "");
    }
  };
  if (originalLogo.complete) showOriginal();
  else originalLogo.addEventListener("load", showOriginal, { once: true });
}
