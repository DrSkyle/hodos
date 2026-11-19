import "./cartographic.css";
import "./garage.css";
import "./pwa";
import { DOWNLOAD_URL } from "./site-constants";
import { detectVisitorCountryByIp } from "./offers";
import { wireThemeToggle } from "./theme";

wireThemeToggle("theme-toggle");

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

// The referral programme and Nepal-specific nav are revealed ONLY when the
// visitor's IP resolves to Nepal. The referral page and API also enforce Nepal
// server-side.
void detectVisitorCountryByIp().then((country) => {
  if (country !== "NP") return;
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
});

// Close the mobile menu after a choice, and on Escape.
for (const menu of document.querySelectorAll<HTMLDetailsElement>("details.nav-menu")) {
  menu.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => menu.removeAttribute("open"));
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  for (const menu of document.querySelectorAll<HTMLDetailsElement>("details.nav-menu[open]")) {
    menu.removeAttribute("open");
    menu.querySelector("summary")?.focus();
  }
});
