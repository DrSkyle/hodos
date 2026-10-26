import "./landing.css";
import "./showcase.css";
import "./art-direction.css";
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
