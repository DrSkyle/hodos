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
