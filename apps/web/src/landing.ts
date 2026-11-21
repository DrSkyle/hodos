import "./cartographic.css";
import "./garage.css";
import "./pwa";
import { detectVisitorCountryByIp } from "./offers";
import { wireThemeToggle } from "./theme";

wireThemeToggle("theme-toggle");

// Matches appwrite/functions/hodos-api durationFactor() + Access tier ($0.19/day, ~135 NPR/USD).
const NEPAL_BASE_USD_DAY = 0.19;

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

const FX_BY_COUNTRY: Record<"NP" | "IN", { currency: string; fx: number; locale: string; label: string; payout: string }> = {
  NP: { currency: "NPR", fx: 135, locale: "en-NP", label: "Nepal", payout: "eSewa, Khalti or IME Pay" },
  IN: { currency: "₹", fx: 84, locale: "en-IN", label: "India", payout: "UPI or IMPS" }
};

function wireCountryCalculator(country: "NP" | "IN") {
  const cfg = FX_BY_COUNTRY[country];
  const slider = document.getElementById("calc-shops") as HTMLInputElement | null;
  const shopsVal = document.getElementById("calc-shops-val");
  const earnEl = document.getElementById("calc-earn-npr");
  const metaEl = document.getElementById("calc-meta");
  const planButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".calc-plan"));
  if (!slider || !earnEl) return;

  if (country === "IN") {
    const eyebrow = document.querySelector("#nepal-earn .eyebrow, #nepal-earn .garage-eyebrow");
    const title = document.querySelector("#nepal-earn h2");
    const desc = document.querySelector("#nepal-earn p.lead, #nepal-earn p");
    const steps = document.querySelector("#nepal-earn .steps") as HTMLElement | null;
    const calc = document.querySelector("#nepal-earn .nepal-calc") as HTMLElement | null;
    if (eyebrow) eyebrow.textContent = "India · 60 / 40 revenue share";
    if (title) title.textContent = "Introduce a shop. Earn 60% via UPI or IMPS.";
    if (desc) {
      desc.textContent =
        "Know a tyre & puncture shop, garage, EV charger, dhaba, hotel, or pharmacy along the road? Every time they buy or extend a pin on Hodos, 60% of their payment is credited to your account and unlocks for UPI / IMPS cashout 30 days after payment clears.";
    }
    if (steps) steps.hidden = false;
    if (calc) calc.hidden = false;
  }

  let planDays = 30;
  const fmt = new Intl.NumberFormat(cfg.locale, { maximumFractionDigits: 0 });

  const renderCalc = () => {
    const shops = Math.max(1, Number(slider.value) || 10);
    const perShop = NEPAL_BASE_USD_DAY * durationFactor(planDays) * planDays * cfg.fx;
    const share = perShop * shops * 0.6;
    if (shopsVal) shopsVal.textContent = String(shops);
    const prefix = cfg.currency === "₹" ? "₹" : `${cfg.currency} `;
    earnEl.textContent = `${prefix}${fmt.format(Math.round(share))}`;
    if (metaEl) {
      const span = planDays === 365 ? "1-year" : `${planDays}-day`;
      metaEl.textContent = `Based on ${shops} ${cfg.label} shop${shops === 1 ? "" : "s"} on a ${span} pin (~${prefix}${fmt.format(Math.round(perShop))} each). Renewals pay you 60% again (${cfg.payout}).`;
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

// Country-specific launch & referral personalization for Nepal and India.
void detectVisitorCountryByIp().then((country) => {
  if (country !== "NP" && country !== "IN") return;

  if (country === "NP") {
    const shopsLead = document.querySelector("#shops .lead");
    const accessPrice = document.querySelector("#shops .plan:first-child .plan-price");
    const accessCta = document.querySelector("#shops .plan:first-child .plan-cta a");
    if (shopsLead) {
      shopsLead.textContent =
        "Shop pins in Nepal are completely free initially. If your shop sells or repairs anything drivers and riders need along the road, put a pin on the map at no cost.";
    }
    if (accessPrice) accessPrice.innerHTML = "Free<small>initially in Nepal · NPR 0 (no payment needed)</small>";
    if (accessCta) accessCta.textContent = "Place a free pin";
  } else if (country === "IN") {
    document.getElementById("nepal-earn")?.removeAttribute("hidden");
    document.getElementById("footer-referrals")?.removeAttribute("hidden");
    document.getElementById("nav-referrals")?.removeAttribute("hidden");
    document.getElementById("mobile-referrals")?.removeAttribute("hidden");
    wireCountryCalculator("IN");

    const step1Title = document.querySelector("#nepal-earn .step-card:first-child h3");
    const step1Desc = document.querySelector("#nepal-earn .step-card:first-child p");
    const calcLabel = document.querySelector("#nepal-earn .nepal-calc-result .mono-label");
    const ctas = document.querySelector("#nepal-earn .section-cta") as HTMLElement | null;
    if (step1Title) step1Title.textContent = "One code, tied to your UPI or IMPS account";
    if (step1Desc) step1Desc.textContent = "Confirm your location in India and link your UPI ID or bank account in thirty seconds.";
    if (calcLabel) calcLabel.textContent = "Your 60% share (UPI / IMPS)";
    if (ctas) {
      ctas.innerHTML = `
        <a class="btn btn-primary" href="/referrals">Get your referral code</a>
        <a class="btn btn-ghost" href="/garage">Open the India Garage</a>
      `;
    }

    const accessPrice = document.querySelector("#shops .plan:first-child .plan-price");
    if (accessPrice) accessPrice.innerHTML = "₹16<small>a day · India (UPI / IMPS)</small>";
  }
});

/**
 * Signature scroll-driven continuous road scene.
 *
 * Translates one continuous 2400px SVG road landscape sideways as the visitor
 * scrolls vertically through `.road-scene-section`. Automatically disables
 * horizontal camera translation on mobile viewports (<= 900px) and when
 * `prefers-reduced-motion: reduce` is enabled so the story reads vertically.
 */
function wireContinuousRoadScene() {
  const section = document.querySelector<HTMLElement>(".road-scene-section");
  const viewport = document.getElementById("road-camera-viewport");
  const world = document.getElementById("road-world");
  const fill = document.getElementById("road-scene-fill");
  const readout = document.getElementById("road-scene-readout");
  if (!section || !viewport || !world) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let rafId = 0;

  const update = () => {
    rafId = 0;
    if (window.innerWidth <= 900 || reducedMotion.matches) {
      world.style.transform = "";
      world.dataset.stage = "all";
      return;
    }

    const rect = section.getBoundingClientRect();
    const scrollable = Math.max(1, section.offsetHeight - window.innerHeight);
    const scrolled = Math.min(Math.max(0, -rect.top), scrollable);
    const progress = scrolled / scrollable;

    const maxShift = Math.max(0, world.scrollWidth - viewport.clientWidth);
    world.style.transform = `translate3d(${(-progress * maxShift).toFixed(1)}px, 0, 0)`;

    const stage = progress < 0.34 ? "1" : progress < 0.68 ? "2" : "3";
    world.dataset.stage = stage;

    if (fill) {
      fill.style.width = `${Math.round(progress * 100)}%`;
    }
    if (readout) {
      readout.textContent = `0${stage} / 03`;
    }
  };

  const onScroll = () => {
    if (!rafId) rafId = window.requestAnimationFrame(update);
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  reducedMotion.addEventListener?.("change", onScroll);
  update();
}

wireContinuousRoadScene();

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
