import "./cartographic.css";
import "./garage.css";
import "./pwa";
import { DOWNLOAD_URL } from "./site-constants";
import { visitorCountry } from "./offers";
import { mountHeroInstrument } from "./hero-instrument";
import { wireThemeToggle } from "./theme";

wireThemeToggle("theme-toggle");

const isNepal = visitorCountry() === "NP";
mountHeroInstrument(isNepal);

// Matches appwrite/functions/hodos-api durationFactor() + Access tier ($0.19/day, ~135 NPR/USD).
const NEPAL_BASE_USD_DAY = 0.19;
const NEPAL_FX_NPR = 135;
function durationFactor(days: number): number {
  if (days >= 365) return 0.6;
  if (days >= 180) return 0.7;
  if (days >= 90) return 0.78;
  if (days >= 30) return 0.85;
  if (days >= 14) return 0.9;
  if (days >= 7) return 0.93;
  if (days >= 3) return 0.97;
  return 1;
}

function wireNepalCalculator() {
  const slider = document.getElementById("calc-shops") as HTMLInputElement | null;
  const shopsVal = document.getElementById("calc-shops-val");
  const earnEl = document.getElementById("calc-earn-npr");
  const metaEl = document.getElementById("calc-meta");
  const planButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".calc-plan"));
  if (!slider || !earnEl) return;

  let planDays = 30;
  const fmt = new Intl.NumberFormat("en-NP", { maximumFractionDigits: 0 });

  const renderCalc = () => {
    const shops = Math.max(1, Number(slider.value) || 10);
    const perShopNpr = NEPAL_BASE_USD_DAY * durationFactor(planDays) * planDays * NEPAL_FX_NPR;
    const shareNpr = perShopNpr * shops * 0.6;
    if (shopsVal) shopsVal.textContent = String(shops);
    earnEl.textContent = `NPR ${fmt.format(Math.round(shareNpr))}`;
    if (metaEl) {
      const span = planDays === 365 ? "1-year" : `${planDays}-day`;
      metaEl.textContent = `Based on ${shops} Nepal shop${shops === 1 ? "" : "s"} on a ${span} pin (~NPR ${fmt.format(Math.round(perShopNpr))} each). Renewals pay you 60% again.`;
    }
    for (const btn of planButtons) {
      btn.setAttribute("aria-pressed", String(Number(btn.dataset.days) === planDays));
    }
  };

  slider.addEventListener("input", renderCalc);
  for (const btn of planButtons) {
    btn.addEventListener("click", () => {
      planDays = Number(btn.dataset.days) || 30;
      renderCalc();
    });
  }
  renderCalc();
}

// The referral programme and Nepal-personalized hero/nav are revealed when the
// visitor is in Nepal. The page and API also enforce the territory server-side.
if (isNepal) {
  document.getElementById("footer-referrals")?.removeAttribute("hidden");
  document.getElementById("nav-referrals")?.removeAttribute("hidden");
  document.getElementById("mobile-referrals")?.removeAttribute("hidden");
  document.getElementById("nepal-earn")?.removeAttribute("hidden");
  wireNepalCalculator();

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
