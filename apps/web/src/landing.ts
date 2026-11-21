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
    const eyebrow = document.querySelector("#nepal-earn .garage-eyebrow");
    const title = document.querySelector("#nepal-earn h2");
    const desc = document.querySelector("#nepal-earn p");
    if (eyebrow) eyebrow.textContent = "India · 60 / 40";
    if (title) title.textContent = "Introduce a shop. Earn 60% via UPI or IMPS.";
    if (desc) {
      desc.textContent =
        "Know a tyre & puncture shop, garage, EV charger, dhaba, hotel, or pharmacy along the road? Every time they buy or extend a pin on Hodos, 60% of their payment is credited to your account and unlocks for UPI / IMPS cashout 30 days after payment clears.";
    }
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

// The referral programme and country-specific nav are revealed ONLY when the
// visitor's IP resolves to Nepal or India.
void detectVisitorCountryByIp().then((country) => {
  if (country !== "NP" && country !== "IN") return;
  document.getElementById("nepal-earn")?.removeAttribute("hidden");

  if (country === "NP") {
    const eyebrow = document.querySelector("#nepal-earn .garage-eyebrow");
    const title = document.querySelector("#nepal-earn h2");
    const desc = document.querySelector("#nepal-earn p");
    const calc = document.querySelector("#nepal-earn .nepal-calc") as HTMLElement | null;
    if (eyebrow) eyebrow.textContent = "Nepal · Free launch";
    if (title) title.textContent = "Shop pins in Nepal are free initially.";
    if (desc) {
      desc.textContent =
        "Placing a shop pin on Hodos in Nepal is completely free right now — no payment needed. Because pins are free, the Nepal referral programme has been stopped for now.";
    }
    if (calc) calc.hidden = true;
  } else {
    document.getElementById("footer-referrals")?.removeAttribute("hidden");
    document.getElementById("nav-referrals")?.removeAttribute("hidden");
    document.getElementById("mobile-referrals")?.removeAttribute("hidden");
    wireCountryCalculator(country);
  }

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
