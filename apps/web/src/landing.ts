import "./cartographic.css";

const year = document.querySelector("[data-year]");
if (year) year.textContent = String(new Date().getFullYear());

// Initialize interactive web map asynchronously when present
if (document.getElementById("hodos-web-map")) {
  void import("./web-map").then(({ initWebMap }) => {
    void initWebMap("hodos-web-map", "map-status");
  });
}
// Invalidate the retired web application's service workers before displaying the static site.
if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.getRegistrations().then(items =>
    Promise.all(items.map(item => item.unregister()))
  ).catch(() => {});
}
if ("caches" in window) {
  void caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith("hodos-")).map(key => caches.delete(key))
  )).catch(() => {});
}
// Anchor navigation should close the mobile menu after selection.
document.querySelectorAll(".mobile-nav nav a").forEach(link => {
  link.addEventListener("click", () => {
    const menu = link.closest("details");
    if (menu instanceof HTMLDetailsElement) menu.open = false;
  });
});
