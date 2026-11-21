import "./cartographic.css";
import "./garage.css";
import "./pwa";
import { wireThemeToggle } from "./theme";

wireThemeToggle("theme-toggle");

// Matches hodos-india-api durationFactor() + Access tier ($0.19/day, ~84 INR/USD = ₹15.96/day).
const INDIA_BASE_USD_DAY = 0.19;
const INDIA_FX_INR = 84;

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

function wireIndiaCalculator() {
  const slider = document.getElementById("calc-shops") as HTMLInputElement | null;
  const shopsVal = document.getElementById("calc-shops-val");
  const earnEl = document.getElementById("calc-earn-inr");
  const metaEl = document.getElementById("calc-meta");
  const planButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".calc-plan"));
  if (!slider || !earnEl) return;

  let planDays = 30;
  const fmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

  const renderCalc = () => {
    const shops = Math.max(1, Number(slider.value) || 10);
    const perShopInr = INDIA_BASE_USD_DAY * durationFactor(planDays) * planDays * INDIA_FX_INR;
    const shareInr = perShopInr * shops * 0.6;
    if (shopsVal) shopsVal.textContent = String(shops);
    earnEl.textContent = `₹${fmt.format(Math.round(shareInr))}`;
    if (metaEl) {
      const span = planDays === 365 ? "1-year" : `${planDays}-day`;
      metaEl.textContent = `Based on ${shops} Indian shop${shops === 1 ? "" : "s"} on a ${span} pin (~₹${fmt.format(Math.round(perShopInr))} each). Renewals pay you 60% again.`;
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

wireIndiaCalculator();

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
