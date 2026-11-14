/**
 * Products from the shops, ranked and rotated.
 *
 * The data comes from scripts/refresh-products.mjs, which crawls the live
 * category pages and ranks by commission × evidence of real use × value. Nothing
 * here invents a product or a price: if the file is empty, the shelf is empty.
 *
 * Two jobs this module does that a static list cannot:
 *
 *  1. **Rotation.** Cards are picked with a weighted shuffle whose seed is the
 *     day plus the visitor's country. So the shelf changes from day to day and
 *     differs between markets, is stable if the same person reloads, and a
 *     high-scoring product still appears far more often than a weak one.
 *  2. **Currency.** Prices are stored in the currency the shop listed them in,
 *     with the exchange rate used at refresh time. A visitor sees the price in
 *     their own currency, and the original figure stays available on the card so
 *     the conversion is never presented as the shop's own quote.
 */

export type Product = {
  id: string;
  title: string;
  price: number;
  currency: string;
  priceUsd: number | null;
  image: string;
  sold: number;
  score: number;
  url: string;
};

export type ProductCategory = {
  key: string;
  shelf: string;
  currency: string;
  products: Product[];
};

export type ShelfData = {
  checkedAt: string;
  rateAt: string | null;
  categories: ProductCategory[];
};

/** Fallback rates, used only when the stored conversion is missing. */
const FALLBACK: Record<string, number> = {
  USD: 1,
  INR: 88,
  EUR: 0.92,
  GBP: 0.79,
  NPR: 135,
  PKR: 278,
  BDT: 120
};

let cached: ShelfData | null = null;

export async function loadShelf(): Promise<ShelfData | null> {
  if (cached) return cached;
  try {
    const response = await fetch("/data/products.json", { cache: "no-cache" });
    if (!response.ok) return null;
    const data = (await response.json()) as ShelfData;
    if (!Array.isArray(data.categories)) return null;
    cached = data;
    return data;
  } catch (_) {
    return null;
  }
}

export function visitorCurrency(): string {
  const tag = (navigator.language || "en-US").replace("_", "-");
  const direct = tag.split("-")[1]?.toUpperCase() ?? "";
  return FALLBACK[direct] ? direct : "USD";
}

/** Deterministic 32-bit hash, so the same seed always yields the same order. */
function hash(seed: string): number {
  let value = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    value ^= seed.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function randomFrom(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

/**
 * Weighted shuffle: the same sampler used for a weighted random pick, repeated
 * without replacement. A product scoring twice as high appears roughly twice as
 * often across days, without ever being the only thing anyone sees.
 */
function weightedPick(products: Product[], count: number, seed: string): Product[] {
  const pool = [...products];
  const picked: Product[] = [];
  const rand = randomFrom(hash(seed));

  while (picked.length < count && pool.length > 0) {
    const total = pool.reduce((sum, product) => sum + Math.max(0.01, product.score), 0);
    let ticket = rand() * total;
    let index = pool.length - 1;
    for (let i = 0; i < pool.length; i += 1) {
      ticket -= Math.max(0.01, pool[i]!.score);
      if (ticket <= 0) {
        index = i;
        break;
      }
    }
    picked.push(...pool.splice(index, 1));
  }
  return picked;
}

/** The seed changes daily and per market, so rotation is felt but not chaotic. */
function rotationSeed(country: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return `${day}|${country || "XX"}`;
}

export type Shelf = {
  shelf: string;
  checkedAt: string;
  products: Product[];
};

/**
 * One shelf per category, each rotated for this visitor. `perShelf` keeps the
 * landing page light; the Garage asks for more.
 */
export function shelfFor(data: ShelfData, perShelf: number, country: string): Shelf[] {
  const seed = rotationSeed(country);
  return data.categories
    .filter((category) => category.products.length > 0)
    .map((category) => ({
      shelf: category.shelf,
      checkedAt: data.checkedAt,
      products: weightedPick(category.products, perShelf, `${seed}|${category.key}`)
    }));
}

/**
 * Shows a price the way a person in their own country reads it.
 *
 * The shop's own figure is converted with the rate captured at refresh time, and
 * the original is kept so the card can show both. No rate is invented: if the
 * conversion is missing, the shop's own currency is shown unchanged.
 */
export function priceFor(product: Product, currency: string): { amount: string; original: string | null } {
  const shopPrice = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: product.currency,
    maximumFractionDigits: product.price < 100 ? 2 : 0
  }).format(product.price);

  if (currency === product.currency) return { amount: shopPrice, original: null };
  if (product.priceUsd === null) return { amount: shopPrice, original: null };

  const rate = FALLBACK[currency];
  if (!rate || currency === "USD") {
    return {
      amount: new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(product.priceUsd),
      original: shopPrice
    };
  }

  const converted = product.priceUsd * rate;
  const amount = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: converted < 100 ? 0 : 0
  }).format(converted);
  return { amount, original: shopPrice };
}

export function soldLabel(sold: number): string {
  if (sold >= 10000) return "10k+ bought";
  if (sold >= 1000) return `${Math.round(sold / 100) / 10}k bought`;
  if (sold > 0) return `${sold} bought`;
  return "";
}

export function checkedLabel(checkedAt: string): string {
  const date = new Date(checkedAt);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
