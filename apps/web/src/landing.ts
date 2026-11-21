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
    const accessItem = document.querySelector("#shops .v2-ui-item:first-child strong");
    if (shopsLead) {
      shopsLead.textContent =
        "Shop pins in Nepal are completely free initially. If your shop sells or repairs anything drivers and riders need along the road, put a pin on the map at no cost.";
    }
    if (accessItem) accessItem.textContent = "Free initially (NPR 0)";
  } else if (country === "IN") {
    const ann = document.querySelector("#top-announcement p");
    if (ann) {
      ann.innerHTML =
        'India 60 / 40 referral programme is live — earn 60% of every shop pin via UPI or IMPS. <a href="/referrals">Get your referral code →</a>';
    }
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
        <a class="v2-pill-btn v2-pill-primary" href="/referrals">Get your referral code</a>
        <a class="v2-pill-btn v2-pill-secondary" href="/garage">Open the India Garage</a>
      `;
    }

    const accessItem = document.querySelector("#shops .v2-ui-item:first-child strong");
    if (accessItem) accessItem.textContent = "₹16 / day (UPI / IMPS)";
  }
});

/**
 * Interactive tabs inside the Hero UI mockup.
 */
function wireHeroMockupTabs() {
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>(".v2-tab[data-preview]"));
  const panels = Array.from(document.querySelectorAll<HTMLElement>(".v2-mockup-panel[data-panel]"));
  if (!tabs.length || !panels.length) return;

  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      const target = tab.dataset.preview;
      if (!target) return;
      for (const t of tabs) {
        t.setAttribute("aria-selected", String(t === tab));
      }
      for (const panel of panels) {
        panel.hidden = panel.dataset.panel !== target;
      }
    });
  }
}

wireHeroMockupTabs();

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
