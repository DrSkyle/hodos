// Single source of truth for site-wide constants, shared by vite.config.ts
// (build-time HTML substitution) and runtime TS modules.
export const SITE_VERSION = "3.0.1";
export const DOWNLOAD_URL = "https://github.com/DrSkyle/hodos/releases";
export const REPO_URL = "https://github.com/DrSkyle/hodos";
export const CONTACT_EMAIL = "hodos@devilabs.dev";
export const SITE_URL = "https://hodos.devilabs.dev";
export const INSTAGRAM_URL = "https://www.instagram.com/minerva__corporation/";

/**
 * Advertising is configured in exactly one place.
 *
 * Paste the ad code from the Mitgo product you connect this ad space to
 * (Mitgo ID → Ad spaces → connect a product). Verification alone does not
 * produce a tag — the product does.
 *
 * While this is empty, no ad element is rendered anywhere on the site: there is
 * no placeholder box, no reserved gap and no request to any ad server. Ads also
 * never run in the web app or over the live map.
 */
export const AD_TAG_HTML = "";

/**
 * Affiliate links, one per joined program.
 *
 * In Admitad: Programs → the program → "Banners and Links" → the main
 * affiliate link. Each looks like https://ad.admitad.com/g/<your-id>/ and is
 * bound to the ad space "devilabs", so they cannot be guessed or shared.
 *
 * A program left empty simply does not appear on the site. Nothing is invented:
 * a filled link becomes a tracked deeplink to that shop's own live page.
 */
export const AFFILIATE_LINKS = {
  aliexpress: "",
  banggood: "",
  airalo: "",
  klook: ""
} as const;

export type AffiliateProgram = keyof typeof AFFILIATE_LINKS;

/**
 * Placements are not paid up front. A pin goes live and we ask for the money
 * afterwards — Payoneer invoice today, Paddle once there is a fixed-price item
 * to sell. This is the address those invoices point at.
 */
export const BILLING_EMAIL = "hodos@devilabs.dev";

/**
 * Authorised-seller lines for /ads.txt, one per line, e.g.
 * `mitgo.com, <publisher-id>, DIRECT`. The file is only published once there is
 * something true to declare.
 */
export const ADS_TXT_LINES: string[] = [];

// Appwrite is the only backend. The Garage reads affiliate offers through the
// hodos-affiliate function so the Channel3 key never reaches the browser.
export const APPWRITE_ENDPOINT = "https://sgp.cloud.appwrite.io/v1";
export const APPWRITE_PROJECT_ID = "6ad7939a002ff135e419";
export const GARAGE_FUNCTION = "hodos-affiliate";
