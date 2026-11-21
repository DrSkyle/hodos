import "./cartographic.css";
import "./garage.css";
import "./partners.css";
import { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID } from "./site-constants";
import { wireThemeToggle } from "./theme";

wireThemeToggle("theme-toggle");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function subscribeWaitlist(email: string, source: string): Promise<void> {
  const response = await fetch(`${APPWRITE_ENDPOINT}/functions/hodos-affiliate/executions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Appwrite-Project": APPWRITE_PROJECT_ID
    },
    body: JSON.stringify({
      body: JSON.stringify({ action: "subscribe", email, source }),
      method: "POST",
      path: "/"
    })
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

const form = document.getElementById("newsletter-form") as HTMLFormElement | null;
const emailInput = document.getElementById("newsletter-email") as HTMLInputElement | null;
const statusEl = document.getElementById("newsletter-status") as HTMLElement | null;

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = (emailInput?.value || "").trim();
  if (!EMAIL_RE.test(email)) {
    if (statusEl) {
      statusEl.textContent = "Enter a valid email address.";
      statusEl.dataset.tone = "error";
    }
    return;
  }
  if (statusEl) {
    statusEl.textContent = "Subscribing…";
    statusEl.dataset.tone = "idle";
  }
  try {
    await subscribeWaitlist(email, "india-referrals-waitlist");
    if (statusEl) {
      statusEl.textContent = "Subscribed — we'll email you when referrals come back online.";
      statusEl.dataset.tone = "ok";
    }
    form.reset();
  } catch {
    if (statusEl) {
      statusEl.textContent = "Could not subscribe right now. Please try again.";
      statusEl.dataset.tone = "error";
    }
  }
});
