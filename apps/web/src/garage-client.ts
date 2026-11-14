import { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, GARAGE_FUNCTION } from "./site-constants";

/**
 * One client for the Garage, shared by the landing page and /garage.
 *
 * Both surfaces read the same backend function, the same category slots and the
 * same price formatting, so the shelf can never drift between pages.
 */

export type GearOffer = {
  id: string;
  title: string;
  brand: string | null;
  image: string | null;
  price: number | null;
  compareAt: number | null;
  currency: string;
  merchant: string | null;
  url: string;
};

export type GarageSlot = {
  id: string;
  label: string;
  /** Short shelf description used by the landing page index. */
  blurb: string;
};

export const DEFAULT_GARAGE_SLOT_ID = "inflator";

export const GARAGE_SLOT_STORAGE_KEY = "hodos.garage.slot.v1";

export const GARAGE_SLOTS: GarageSlot[] = [
  { id: "inflator", label: "Tire inflator", blurb: "Top up a soft tire in a car park, not a queue." },
  { id: "mount", label: "Phone mount", blurb: "A mount that survives a bad road." },
  { id: "dashcam", label: "Dash cam", blurb: "Proof for the pothole that costs you a rim." },
  { id: "pressure", label: "Pressure gauge", blurb: "Read the tire before it reads the road." },
  { id: "care", label: "Wash kit", blurb: "Salt, mud and brake dust, handled." },
  { id: "wipers", label: "Wipers", blurb: "The cheapest safety upgrade there is." },
  { id: "tires", label: "Tires", blurb: "The one part of the car the road talks to." },
  { id: "light", label: "Lights", blurb: "See the unlit stretch before it sees you." }
];

export function isGarageSlot(value: string | null | undefined): value is string {
  return GARAGE_SLOTS.some((slot) => slot.id === value);
}

export const GARAGE_ENDPOINT = `${APPWRITE_ENDPOINT}/functions/${GARAGE_FUNCTION}/executions`;

/** Runs the backend function and unwraps the inner JSON it responded with. */
export async function callGarage(payload: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(GARAGE_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Appwrite-Project": APPWRITE_PROJECT_ID
    },
    body: JSON.stringify({ body: JSON.stringify(payload), method: "POST", path: "/" })
  });
  if (!response.ok) throw new Error(`backend ${response.status}`);
  const execution = await response.json();
  const inner = execution?.responseBody;
  if (typeof inner !== "string") throw new Error("empty response");
  return JSON.parse(inner);
}

export async function loadOffers(slot: string): Promise<GearOffer[]> {
  const data = (await callGarage({ action: "offers", slot })) as {
    ok?: boolean;
    products?: GearOffer[];
    error?: string;
  };
  if (!data?.ok) throw new Error(data?.error || "catalogue unavailable");
  return data.products ?? [];
}

export async function subscribeEmail(email: string, source: string): Promise<void> {
  const result = (await callGarage({ action: "subscribe", email, source })) as {
    ok?: boolean;
    error?: string;
  };
  if (!result?.ok) throw new Error(result?.error || "could not save");
}

export function isValidEmail(value: string): boolean {
  const clean = value.trim();
  return clean.length >= 5 && clean.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean);
}

export function money(value: number | null, currency: string): string {
  if (value === null) return "";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2
    }).format(value);
  } catch (_) {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export function offerMeta(offer: GearOffer): string {
  return [offer.brand, offer.merchant].filter(Boolean).join(" · ");
}

export function wasPrice(offer: GearOffer): string | null {
  if (offer.compareAt === null || offer.price === null) return null;
  if (offer.compareAt <= offer.price) return null;
  return money(offer.compareAt, offer.currency);
}
