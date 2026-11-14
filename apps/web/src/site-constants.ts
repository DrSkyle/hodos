// Single source of truth for site-wide constants, shared by vite.config.ts
// (build-time HTML substitution) and runtime TS modules.
export const SITE_VERSION = "3.0.1";
export const DOWNLOAD_URL = "https://github.com/DrSkyle/hodos/releases";
export const REPO_URL = "https://github.com/DrSkyle/hodos";
export const CONTACT_EMAIL = "hodos@devilabs.dev";
export const SITE_URL = "https://hodos.devilabs.dev";
export const INSTAGRAM_URL = "https://www.instagram.com/minerva__corporation/";

// Appwrite is the only backend. The Garage reads affiliate offers through the
// hodos-affiliate function so the Channel3 key never reaches the browser.
export const APPWRITE_ENDPOINT = "https://sgp.cloud.appwrite.io/v1";
export const APPWRITE_PROJECT_ID = "6ad7939a002ff135e419";
export const GARAGE_FUNCTION = "hodos-affiliate";
