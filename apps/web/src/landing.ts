import "./cartographic.css";
import "./garage.css";
import "./landing-garage";

// Purge any legacy PWA service workers and caches
if ("serviceWorker" in navigator) {
  void navigator.serviceWorker
    .getRegistrations()
    .then((items) => Promise.all(items.map((item) => item.unregister())))
    .catch(() => {});
}
if ("caches" in window) {
  void caches
    .keys()
    .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
    .catch(() => {});
}

document.querySelectorAll<HTMLAnchorElement>(".nav-menu-panel a").forEach((link) => {
  link.addEventListener("click", () => {
    link.closest("details")?.removeAttribute("open");
  });
});

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
if (!prefersReducedMotion) {
  const parallaxElements = Array.from(document.querySelectorAll<HTMLElement>("[data-parallax]"));
  let ticking = false;

  const updateParallax = () => {
    const viewportCenter = window.innerHeight / 2;
    for (const el of parallaxElements) {
      const speed = parseFloat(el.dataset.parallax || "0");
      if (!speed || window.innerWidth <= 900) {
        el.style.transform = "";
        continue;
      }
      const rect = el.getBoundingClientRect();
      const elementCenter = rect.top + rect.height / 2;
      const offset = (elementCenter - viewportCenter) * speed;
      el.style.transform = `translate3d(0, ${offset.toFixed(1)}px, 0)`;
    }
    ticking = false;
  };

  window.addEventListener(
    "scroll",
    () => {
      if (!ticking) {
        window.requestAnimationFrame(updateParallax);
        ticking = true;
      }
    },
    { passive: true }
  );
  window.addEventListener("resize", updateParallax, { passive: true });
  updateParallax();
}
