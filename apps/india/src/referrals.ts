import "./cartographic.css";
import "./garage.css";
import "./partners.css";
import { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, INDIA_API_FUNCTION } from "./site-constants";
import { wireThemeToggle } from "./theme";

/**
 * Referral earnings, India only.
 *
 * The browser asks for a position, sends it to hodos-india-api, and the backend
 * decides — using India's coordinates AND an Indian UPI or IMPS payout account.
 */

wireThemeToggle("theme-toggle");

const ENDPOINT = `${APPWRITE_ENDPOINT}/functions/${INDIA_API_FUNCTION}/executions`;
const INR_PER_USD = 84;
const STORAGE_KEY = "hodos.india.referralCode";

type Referral = {
  ok: boolean;
  error?: string;
  code?: string;
  ownerName?: string;
  country?: string;
  payoutMethod?: string;
  payoutAccount?: string;
  share?: number;
  maturityDays?: number;
  earnedUsd?: number;
  paidUsd?: number;
  owedUsd?: number;
  maturedUsd?: number;
  pendingUsd?: number;
  nextCashoutAt?: string | null;
  available?: boolean;
  minPayoutUsd?: number;
  referrals?: number;
  amountUsd?: number;
  next?: string;
};

const gate = document.getElementById("gate") as HTMLElement;
const gateCheck = document.getElementById("gate-check") as HTMLElement;
const gateStatus = document.getElementById("gate-status") as HTMLElement;
const gateDenied = document.getElementById("gate-denied") as HTMLElement;
const gateDeniedText = document.getElementById("gate-denied-text") as HTMLElement;
const gateLocate = document.getElementById("gate-locate") as HTMLButtonElement;
const app = document.getElementById("app") as HTMLElement;
const createCard = document.getElementById("create-card") as HTMLElement;
const profileCard = document.getElementById("profile-card") as HTMLElement;

const payoutMethodSelect = document.getElementById("payout-method") as HTMLSelectElement | null;
const payoutAccountLabel = document.getElementById("payout-account-label");
const payoutAccountInput = document.getElementById("payout-account-input") as HTMLInputElement | null;
const payoutAccountHint = document.getElementById("payout-account-hint");

let position: { lat: number; lng: number } | null = null;
let current: Referral | null = null;

async function callApi(payload: Record<string, unknown>): Promise<Referral> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Appwrite-Project": APPWRITE_PROJECT_ID
    },
    body: JSON.stringify({ body: JSON.stringify(payload), method: "POST", path: "/" })
  });
  const execution = await response.json();
  const inner = execution?.responseBody;
  if (typeof inner !== "string") throw new Error("empty response");
  return JSON.parse(inner) as Referral;
}

const inrFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
function moneyInr(usdValue: number | undefined): string {
  const usd = Number(usdValue) || 0;
  const inr = Math.round(usd * INR_PER_USD);
  return `₹${inrFmt.format(inr)} ($${usd.toFixed(2)})`;
}

function setGateStatus(text: string) {
  if (gateStatus) gateStatus.textContent = text;
}

function deny(reason: string) {
  gateCheck.hidden = true;
  gateDenied.hidden = false;
  app.hidden = true;
  if (gateDeniedText) gateDeniedText.textContent = reason;
}

function openProgramme() {
  gate.hidden = true;
  gateDenied.hidden = true;
  app.hidden = false;
  paint(null);
}

function syncPayoutFieldLabels() {
  const method = payoutMethodSelect?.value || "upi";
  if (method === "upi") {
    if (payoutAccountLabel) payoutAccountLabel.textContent = "UPI ID";
    if (payoutAccountInput) payoutAccountInput.placeholder = "yourname@okicici or 9876543210@ybl";
    if (payoutAccountHint) payoutAccountHint.textContent = "Enter your active UPI ID (VPA) with @handle.";
  } else {
    if (payoutAccountLabel) payoutAccountLabel.textContent = "Bank Account Number + IFSC";
    if (payoutAccountInput) payoutAccountInput.placeholder = "123456789012 / HDFC0001234";
    if (payoutAccountHint) payoutAccountHint.textContent = "Enter your Indian bank account number and 11-character IFSC code.";
  }
}

payoutMethodSelect?.addEventListener("change", syncPayoutFieldLabels);
syncPayoutFieldLabels();

function paint(referral: Referral | null) {
  current = referral;
  const hasCode = Boolean(referral?.ok && referral.code);
  createCard.hidden = hasCode;
  profileCard.hidden = !hasCode;
  if (!hasCode) return;

  try {
    localStorage.setItem(STORAGE_KEY, referral?.code || "");
  } catch (_) {
    // ignore storage errors
  }

  const nameEl = document.getElementById("profile-name");
  const codeEl = document.getElementById("profile-code");
  const linkTextEl = document.getElementById("profile-link-text");
  const earnedEl = document.getElementById("stat-earned");
  const paidEl = document.getElementById("stat-paid");
  const owedEl = document.getElementById("stat-owed");
  const maturedEl = document.getElementById("stat-matured");
  const countEl = document.getElementById("stat-count");
  const targetEl = document.getElementById("payout-target");
  const noteEl = document.getElementById("payout-note");
  const payoutButton = document.getElementById("request-payout") as HTMLButtonElement | null;

  const shareUrl = `${window.location.origin}/partners?ref=${encodeURIComponent(referral?.code || "")}`;
  if (nameEl) nameEl.textContent = referral?.ownerName || "—";
  if (codeEl) codeEl.textContent = referral?.code || "—";
  if (linkTextEl) linkTextEl.textContent = shareUrl;
  if (earnedEl) earnedEl.textContent = moneyInr(referral?.earnedUsd);
  if (paidEl) paidEl.textContent = moneyInr(referral?.paidUsd);
  if (owedEl) owedEl.textContent = moneyInr(referral?.pendingUsd ?? referral?.owedUsd);
  if (maturedEl) maturedEl.textContent = moneyInr(referral?.maturedUsd ?? referral?.owedUsd);
  if (countEl) countEl.textContent = String(referral?.referrals ?? 0);

  const methodLabel = referral?.payoutMethod === "imps" ? "IMPS / Bank" : "UPI";
  if (targetEl) {
    targetEl.textContent = `Payout account: ${methodLabel} (${referral?.payoutAccount || "—"})`;
  }
  if (noteEl) {
    if (referral?.available) {
      noteEl.textContent = "Matured balance is ready for UPI / IMPS payout.";
    } else if (referral?.nextCashoutAt) {
      const dateStr = new Date(referral.nextCashoutAt).toLocaleDateString("en-IN", { dateStyle: "medium" });
      noteEl.textContent = `Next commission matures on ${dateStr} (30-day window).`;
    } else {
      noteEl.textContent = "Minimum cashout is ₹9 ($0.10), unlocked 30 days after each shop payment.";
    }
  }
  if (payoutButton) {
    payoutButton.disabled = !referral?.available;
  }
}

async function locateAndUnlock() {
  if (!navigator.geolocation) {
    deny("Your browser does not support location, so we cannot confirm you are in India.");
    return;
  }
  setGateStatus("Checking location…");
  gateLocate.disabled = true;

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      position = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      openProgramme();
      try {
        const savedCode = localStorage.getItem(STORAGE_KEY) || "";
        if (savedCode) {
          const res = await callApi({
            action: "referralProfile",
            code: savedCode,
            lat: position.lat,
            lng: position.lng,
            payoutMethod: "upi",
            payoutAccount: "check@upi"
          });
          if (res.ok) paint(res);
          else if (res.error?.includes("India only")) deny(res.error);
        }
      } catch (_) {
        // ignore auto-load errors
      }
    },
    () => {
      gateLocate.disabled = false;
      setGateStatus("Location permission is required to confirm you're in India.");
    },
    { enableHighAccuracy: false, timeout: 10000 }
  );
}

gateLocate?.addEventListener("click", locateAndUnlock);

const createForm = document.getElementById("create-form") as HTMLFormElement | null;
const createStatus = document.getElementById("create-status");
createForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!position) {
    setGateStatus("Confirm your India location first.");
    return;
  }
  const fd = new FormData(createForm);
  const ownerName = String(fd.get("ownerName") || "").trim();
  const payoutMethod = String(fd.get("payoutMethod") || "upi").trim();
  const payoutAccount = String(fd.get("payoutAccount") || "").trim();
  const agreed = fd.get("agreeTerms") === "on";

  if (!agreed) {
    if (createStatus) createStatus.textContent = "Please accept the 60% / 30-day maturity terms.";
    return;
  }
  if (createStatus) createStatus.textContent = "Creating code…";

  try {
    const res = await callApi({
      action: "referralCreate",
      ownerName,
      payoutMethod,
      payoutAccount,
      lat: position.lat,
      lng: position.lng
    });
    if (!res.ok) {
      if (res.error?.includes("India only")) {
        deny(res.error);
        return;
      }
      if (createStatus) createStatus.textContent = res.error || "Could not create referral code.";
      return;
    }
    if (createStatus) createStatus.textContent = "";
    paint(res);
  } catch (_) {
    if (createStatus) createStatus.textContent = "Network error — please try again.";
  }
});

const lookupForm = document.getElementById("lookup-form") as HTMLFormElement | null;
const lookupStatus = document.getElementById("lookup-status");
lookupForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!position) return;
  const fd = new FormData(lookupForm);
  const code = String(fd.get("code") || "").trim().toLowerCase();
  if (!code) return;
  if (lookupStatus) lookupStatus.textContent = "Loading…";
  try {
    const res = await callApi({
      action: "referralProfile",
      code,
      lat: position.lat,
      lng: position.lng,
      payoutMethod: "upi",
      payoutAccount: "check@upi"
    });
    if (!res.ok) {
      if (res.error?.includes("India only")) {
        deny(res.error);
        return;
      }
      if (lookupStatus) lookupStatus.textContent = res.error || "Referral code not found.";
      return;
    }
    if (lookupStatus) lookupStatus.textContent = "";
    paint(res);
  } catch (_) {
    if (lookupStatus) lookupStatus.textContent = "Network error — please try again.";
  }
});

document.getElementById("copy-link")?.addEventListener("click", async () => {
  const link = document.getElementById("profile-link-text")?.textContent || "";
  if (!link) return;
  try {
    await navigator.clipboard.writeText(link);
    const btn = document.getElementById("copy-link");
    if (btn) {
      btn.textContent = "Copied!";
      window.setTimeout(() => {
        btn.textContent = "Copy referral link";
      }, 1800);
    }
  } catch (_) {
    // ignore clipboard failures
  }
});

document.getElementById("request-payout")?.addEventListener("click", async () => {
  if (!current?.code || !position) return;
  const payoutStatus = document.getElementById("payout-status");
  if (payoutStatus) payoutStatus.textContent = "Submitting cashout request…";
  try {
    const res = await callApi({
      action: "referralRequestPayout",
      code: current.code,
      lat: position.lat,
      lng: position.lng,
      payoutMethod: current.payoutMethod || "upi",
      payoutAccount: "verified@upi"
    });
    if (payoutStatus) {
      payoutStatus.textContent = res.ok
        ? res.next || "Cashout requested."
        : res.error || "Could not request payout.";
    }
  } catch (_) {
    if (payoutStatus) payoutStatus.textContent = "Network error — please try again.";
  }
});
