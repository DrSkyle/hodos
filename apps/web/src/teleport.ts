import {
  APPWRITE_ENDPOINT,
  APPWRITE_PROJECT_ID,
  isAdmitadTrackingHost
} from "./site-constants";

/**
 * Admitad Teleport, from the browser.
 *
 * Teleport only accepts requests from our own server, and it needs the visitor's
 * user agent, referer and IP — online identifiers. Admitad's publisher terms
 * require consent before those are passed, so this module keeps the consent
 * decision and never routes a click without it.
 *
 * When consent is missing, unavailable or the resolver fails, the link opens
 * exactly as it would have: a plain affiliate link. Nothing is blocked.
 */

const ENDPOINT = `${APPWRITE_ENDPOINT}/functions/hodos-teleport/executions`;
const CONSENT_KEY = "hodos.teleport.consent.v1";

export type ConsentChoice = "granted" | "declined" | "unknown";

export function consent(): ConsentChoice {
  try {
    const value = localStorage.getItem(CONSENT_KEY);
    if (value === "granted" || value === "declined") return value;
  } catch (_) {
    // Private mode: treated as no consent, so no identifiers are passed.
  }
  return "unknown";
}

export function setConsent(choice: Exclude<ConsentChoice, "unknown">) {
  try {
    localStorage.setItem(CONSENT_KEY, choice);
  } catch (_) {
    // Nothing to persist; the choice applies to this page view.
  }
}

/** Only Admitad affiliate links can be resolved; everything else passes through. */
export function isTeleportableUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (!isAdmitadTrackingHost(parsed.hostname)) return false;
    return /^\/g\/[A-Za-z0-9_-]{8,128}\/?$/.test(parsed.pathname);
  } catch (_) {
    return false;
  }
}

type ResolveResult = { ok: boolean; redirectUrl?: string; fallback?: string };

async function resolve(url: string): Promise<ResolveResult> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Appwrite-Project": APPWRITE_PROJECT_ID
    },
    body: JSON.stringify({
      body: JSON.stringify({
        url,
        consent: true,
        userAgent: navigator.userAgent,
        referer: window.location.origin + window.location.pathname,
        subid: "hodos-web"
      }),
      method: "POST",
      path: "/"
    })
  });
  const execution = await response.json().catch(() => null);
  const inner = execution?.responseBody;
  if (typeof inner !== "string") return { ok: false };
  try {
    return JSON.parse(inner) as ResolveResult;
  } catch (_) {
    return { ok: false };
  }
}

/**
 * Wires every affiliate link on the page. Without consent the click is left to
 * the browser; with consent the click is resolved first and then followed.
 */
export function wireAffiliateLinks(root: Document | HTMLElement = document) {
  const links = Array.from(root.querySelectorAll<HTMLAnchorElement>("a[href]")).filter((link) =>
    isTeleportableUrl(link.href)
  );
  for (const link of links) {
    if (link.dataset.teleport === "true") continue;
    link.dataset.teleport = "true";
    link.addEventListener("click", (event) => {
      if (consent() !== "granted") return;
      // A modified click (new tab, download) is the reader's choice; leave it.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      const href = link.href;
      void resolve(href)
        .then((result) => {
          window.location.assign(result.ok && result.redirectUrl ? result.redirectUrl : href);
        })
        .catch(() => window.location.assign(href));
    });
  }
}

/**
 * A one-line notice, shown once, only on pages that actually carry an Admitad
 * link. Declining leaves the link working — it simply is not enriched.
 */
export function offerConsentIfNeeded(root: Document | HTMLElement = document) {
  const hasAffiliate = Array.from(root.querySelectorAll<HTMLAnchorElement>("a[href]")).some((link) =>
    isTeleportableUrl(link.href)
  );
  if (!hasAffiliate || consent() !== "unknown") return;

  const card = document.createElement("div");
  card.className = "consent-note";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "Shop links");
  card.innerHTML = `
    <div class="consent-copy">
      <strong>Shop links can credit Hodos</strong>
      <p>Some shop links carry a referral. With your OK, the click is passed through our server so the shop can credit Hodos — that means sharing your IP address, browser and the page you came from with the affiliate network. Nothing about your journeys is involved.</p>
    </div>
    <div class="consent-actions">
      <button type="button" class="btn btn-primary" data-consent="granted">Allow</button>
      <button type="button" class="btn btn-ghost" data-consent="declined">No thanks</button>
    </div>
  `;
  card.querySelectorAll<HTMLButtonElement>("[data-consent]").forEach((button) => {
    button.addEventListener("click", () => {
      const choice = button.dataset.consent === "granted" ? "granted" : "declined";
      setConsent(choice);
      card.remove();
    });
  });
  document.body.append(card);
}
