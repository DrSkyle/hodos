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
/**
 * Admitad hands out links on its own short tracking domains, not only on
 * admitad.com — the account already has links on seven of them. Anything not in
 * this list is refused, so the teleport resolver can never be pointed at an
 * arbitrary host.
 */
export const ADMITAD_TRACKING_HOSTS = [
  "ad.admitad.com",
  "admitad.com",
  "ntzgd.com",
  "tjzuh.com",
  "yyczo.com",
  "dbnua.com",
  "xcdus.com",
  "dkfrh.com",
  "rzekl.com",
  "kjuzv.com",
  "cafxq.com",
  "xmknb.com",
  "zallj.com",
  "vxrlm.com"
] as const;

/** True when a host is one of Admitad's tracking domains. */
export function isAdmitadTrackingHost(host: string): boolean {
  const lower = host.toLowerCase();
  return ADMITAD_TRACKING_HOSTS.some((allowed) => lower === allowed || lower.endsWith(`.${allowed}`));
}

/**
 * Offer links that already point at one specific shop.
 *
 * These are per-offer links: the destination is baked into the id, so they are
 * used exactly as issued rather than turned into a deeplink. Each is resolved
 * from the account and labelled with the shop it actually opens.
 */
export const OFFER_LINKS = {
  /** → https://www.woopdrive.com/ — car hire, fits road trips. */
  woopdrive: "https://dkfrh.com/g/ffzns2ktmfecd1928bc8d80355ec70/",
  /** → https://global.redmagic.gg/ — gaming phones and accessories. */
  redmagic: "https://yyczo.com/g/qmttmvxh1uecd1928bc856637026d8/",
  /** → https://www.compensair.com/ — flight delay compensation. */
  compensair: "https://dbnua.com/g/5k6m2qm7z5ecd1928bc890465e1588/",
  /** → https://avitovip.com — airport transfers in Turkey, fixed price. */
  avitovip: "https://kjuzv.com/g/02swkf5uv6ecd1928bc8babf13962c/",
  /** → https://www.lennuabi.com — EU flight compensation up to €600. */
  lennuabi: "https://cafxq.com/g/913bhutj0zecd1928bc8a8b9cbb737/",
  /** → https://www.palazzoversace.ae/ — Dubai stopover hotel. */
  versace: "https://xmknb.com/g/6z621dqopyecd1928bc8080b20079f/",
  /** → https://flyfi.io — travel. */
  flyfi: "https://xcdus.com/g/0xtgjon8aeecd1928bc8a2e4f55a9f/",
  /**
   * These three are fashion and belong on the network's style sites, not on a
   * road app: hellomolly.com, bewakoof.com (India), chicme.com.
   */
  hellomolly: "https://ntzgd.com/g/v4mbsetakjecd1928bc85fd6c9cc83/",
  bewakoof: "https://tjzuh.com/g/el5arbwariecd1928bc88f3bde6dea/",
  chicme: "https://rzekl.com/g/gf807z8tarecd1928bc8312b8f391a/"
} as const;

export const AFFILIATE_LINKS = {
  aliexpress: "",
  banggood: "",
  airalo: "",
  klook: "",
  // India: local retailers, so Indian buyers land on shops that ship domestically
  // instead of waiting on an AliExpress parcel.
  hamaramall: "",
  flipkart: "",
  amazonin: "",
  cars24: "",
  tyres: ""
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
