import "./cartographic.css";
import "./garage.css";
import "./partners.css";
import { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID } from "./site-constants";
import { wireThemeToggle } from "./theme";

/**
 * Referral earnings, Nepal only.
 *
 * Nothing here decides whether someone qualifies. The page asks the browser for
 * a position, sends it to the backend, and the backend decides — using Nepal's
 * coordinates AND a Nepali payout wallet. A refused answer hides the whole
 * programme. A script that calls the API directly gets the same refusal, so the
 * browser check is a convenience, not the gate.
 */

wireThemeToggle("theme-toggle");

const ENDPOINT = `${APPWRITE_ENDPOINT}/functions/hodos-api/executions`;

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

function money(value: number | undefined): string {
  return `$${(Number(value) || 0).toFixed(2)}`;
}

function setGateStatus(text: string) {
  if (gateStatus) gateStatus.textContent = text;
}

/** Refuses the programme and says nothing about how it works. */
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

function paint(referral: Referral | null) {
  current = referral;
  const hasCode = Boolean(referral?.ok && referral.code);
  createCard.hidden = hasCode;
  profileCard.hidden = !hasCode;
  if (!hasCode) return;

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
  if (earnedEl) earnedEl.textContent = money(referral?.earnedUsd);
  if (paidEl) paidEl.textContent = money(referral?.paidUsd);
  if (owedEl) owedEl.textContent = money(referral?.owedUsd);
  if (maturedEl) maturedEl.textContent = money(referral?.maturedUsd ?? referral?.owedUsd);
  if (countEl) countEl.textContent = String(referral?.referrals ?? 0);
  if (targetEl) targetEl.textContent = `${referral?.payoutMethod ?? ""} ${referral?.payoutAccount ?? ""}`.trim();

  const available = Boolean(referral?.available);
  if (payoutButton) payoutButton.disabled = false;
  // The agreement is a prerequisite for any payout, so it appears as soon as
  // there is something to pay out.
  const nda = document.getElementById("nda-card");
  if (nda) nda.hidden = !(Number(referral?.earnedUsd) > 0);
  if (noteEl) {
    noteEl.dataset.tone = "idle";
    if (available) {
      noteEl.textContent = `Ready to cash out ${money(referral?.maturedUsd ?? referral?.owedUsd)} to your Nepali wallet.`;
    } else if (Number(referral?.pendingUsd) > 0) {
      const unlockDate = referral?.nextCashoutAt
        ? new Date(referral.nextCashoutAt).toLocaleDateString(undefined, { dateStyle: "medium" })
        : "30 days after the shop's payment";
      noteEl.textContent = `${money(referral?.owedUsd)} is in your referral account right now. Referral commissions unlock for cashout 1 month (30 days) after each shop payment — next cashout unlocks ${unlockDate}.`;
    } else {
      noteEl.textContent = `When a shop you refer pays for their pin, 60% shows here immediately and unlocks for cashout after 30 days (minimum ${money(referral?.minPayoutUsd)}).`;
    }
  }
}

/** Ask the backend whether this position qualifies. It always has the last word. */
async function checkTerritory(lat: number, lng: number): Promise<boolean> {
  try {
    const result = await callApi({
      action: "referralProfile",
      code: "probe000000",
      lat,
      lng,
      payoutMethod: "esewa",
      payoutAccount: "0000000000"
    });
    // An unknown code from an accepted territory is the only "allowed" answer we
    // can get without an existing code: the gate runs before the lookup.
    return result.error === "unknown referral";
  } catch (_) {
    return false;
  }
}

async function useLocation() {
  if (!("geolocation" in navigator)) {
    deny("This browser cannot read a location, so we cannot confirm the programme is open where you are.");
    return;
  }
  gateLocate.disabled = true;
  setGateStatus("Checking your location…");
  navigator.geolocation.getCurrentPosition(
    async (result) => {
      const { latitude, longitude } = result.coords;
      position = { lat: latitude, lng: longitude };
      const allowed = await checkTerritory(latitude, longitude);
      if (allowed) {
        openProgramme();
      } else {
        deny("This programme is open in Nepal only right now.");
      }
    },
    () => {
      gateLocate.disabled = false;
      setGateStatus("We need your location to check whether the programme is open where you are.");
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

gateLocate.addEventListener("click", () => void useLocation());

document.getElementById("copy-code")?.addEventListener("click", async () => {
  const code = current?.code;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    setGateStatus("Code copied.");
  } catch (_) {
    // Clipboard permission can be refused; the code is visible either way.
  }
});

document.getElementById("copy-link")?.addEventListener("click", async () => {
  const code = current?.code;
  if (!code) return;
  const shareUrl = `${window.location.origin}/partners?ref=${encodeURIComponent(code)}`;
  try {
    await navigator.clipboard.writeText(shareUrl);
    setGateStatus("Referral link copied.");
  } catch (_) {
    // ignore
  }
});

document.getElementById("create-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const data = new FormData(form);
  const status = document.getElementById("create-status") as HTMLElement;
  const ownerName = String(data.get("ownerName") || "").trim();
  const payoutMethod = String(data.get("payoutMethod") || "").trim();
  const payoutAccount = String(data.get("payoutAccount") || "").trim();

  if (!position) {
    status.textContent = "Allow location first so we can confirm the programme is open for you.";
    status.dataset.tone = "error";
    return;
  }
  if (ownerName.length < 2) {
    status.textContent = "Add your name so we know who to pay.";
    status.dataset.tone = "error";
    return;
  }
  if (payoutAccount.length < 6) {
    status.textContent = "Add the wallet number we should pay.";
    status.dataset.tone = "error";
    return;
  }

  status.textContent = "Creating your code…";
  status.dataset.tone = "idle";
  try {
    const result = await callApi({
      action: "referralCreate",
      ownerName,
      payoutMethod,
      payoutAccount,
      lat: position.lat,
      lng: position.lng
    });
    if (!result.ok) {
      deny(result.error || "This programme is not available here.");
      return;
    }
    form.reset();
    status.textContent = "";
    paint(result);
  } catch (_) {
    status.textContent = "Could not create that code. Try again in a moment.";
    status.dataset.tone = "error";
  }
});

document.getElementById("lookup-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const data = new FormData(form);
  const status = document.getElementById("lookup-status") as HTMLElement;
  const code = String(data.get("code") || "").trim().toLowerCase();

  if (!position) {
    status.textContent = "Allow location first so we can open your earnings.";
    status.dataset.tone = "error";
    return;
  }
  status.textContent = "Opening…";
  status.dataset.tone = "idle";
  try {
    const result = await callApi({
      action: "referralProfile",
      code,
      lat: position.lat,
      lng: position.lng,
      payoutMethod: "esewa",
      payoutAccount: "0000000000"
    });
    if (!result.ok) {
      status.textContent = result.error || "Could not open that code.";
      status.dataset.tone = "error";
      return;
    }
    status.textContent = "";
    paint(result);
  } catch (_) {
    status.textContent = "Could not open that code. Try again in a moment.";
    status.dataset.tone = "error";
  }
});

document.getElementById("request-payout")?.addEventListener("click", async () => {
  const note = document.getElementById("payout-note") as HTMLElement;
  const button = document.getElementById("request-payout") as HTMLButtonElement | null;
  if (!position || !current?.code) return;

  if (!current.available) {
    note.dataset.tone = "error";
    if (Number(current.pendingUsd) > 0) {
      const unlockDate = current.nextCashoutAt
        ? new Date(current.nextCashoutAt).toLocaleDateString(undefined, { dateStyle: "medium" })
        : "30 days after the shop's payment";
      note.textContent = `Cannot cash out yet — ${money(current.owedUsd)} is in your account, and unlocks 1 month (30 days) after the shop's payment (${unlockDate}).`;
    } else {
      note.textContent = `Cannot request payout — insufficient funds in your account (minimum ${money(current.minPayoutUsd ?? 0.1)} required to cash out).`;
    }
    return;
  }

  if (button) button.disabled = true;
  note.dataset.tone = "idle";
  note.textContent = "Submitting payout request…";
  try {
    const result = await callApi({
      action: "referralRequestPayout",
      code: current.code,
      lat: position.lat,
      lng: position.lng,
      payoutMethod: current.payoutMethod,
      payoutAccount: "0000000000"
    });
    if (result.ok) {
      note.dataset.tone = "ok";
      note.textContent = `Cashout requested for ${money(result.amountUsd ?? current.maturedUsd ?? current.owedUsd)}. Matured commissions are paid to your Nepali wallet.`;
    } else {
      note.dataset.tone = "error";
      note.textContent = result.error || "Could not request a payout.";
    }
  } catch (_) {
    note.dataset.tone = "error";
    note.textContent = "Could not request a payout right now.";
  } finally {
    if (button) button.disabled = false;
  }
});

setGateStatus("Tap the button so we can check whether the programme is open where you are.");
