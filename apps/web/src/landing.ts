import "./cartographic.css";
import "./garage.css";
import "./pwa";
import { DOWNLOAD_URL } from "./site-constants";
import { visitorCountry } from "./offers";

// The referral programme and Nepal-personalized hero/nav are revealed when the
// visitor is in Nepal. The page and API also enforce the territory server-side.
if (visitorCountry() === "NP") {
  document.getElementById("footer-referrals")?.removeAttribute("hidden");
  document.getElementById("nav-referrals")?.removeAttribute("hidden");
  document.getElementById("mobile-referrals")?.removeAttribute("hidden");
  document.getElementById("nepal-earn")?.removeAttribute("hidden");

  // In Nepal, the primary highlighted CTA is downloading the app directly
  // rather than "Shop the Garage" (Nepal's Garage is local map-pin shops).
  const navCta = document.getElementById("nav-primary-cta") as HTMLAnchorElement | null;
  if (navCta) {
    navCta.textContent = "Download the app";
    navCta.href = DOWNLOAD_URL;
  }
  document.querySelector(".nav-links .nav-garage")?.classList.remove("nav-garage");
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
