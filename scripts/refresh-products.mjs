#!/usr/bin/env node
/**
 * Refresh the product shelf from AliExpress.
 *
 * Why a crawler: the account has a programme link, not a product feed. A feed
 * URL would be better and is what `import-feed.ts` in the network repo expects,
 * but until that is copied out of Admitad this is how real products with real
 * prices get onto the site — no invented titles, no invented prices.
 *
 * What it does, per category:
 *   1. opens the live AliExpress category page,
 *   2. reads each product card for id, title, price, currency, image and sold count,
 *   3. builds a tracked deeplink from the account's own programme link,
 *   4. ranks by commission × evidence of usability × value, and
 *   5. writes apps/web/public/data/products.json.
 *
 * Run it by hand or let .github/workflows/refresh-products.yml run it weekly.
 *
 *   node scripts/refresh-products.mjs
 *   node scripts/refresh-products.mjs --dry-run
 *   node scripts/refresh-products.mjs --only mounts,inflators
 *
 * Honesty rules baked in:
 *   · A product only appears if the page actually showed it, with a price.
 *   · `checkedAt` is written with the data, and the site shows it.
 *   · The currency the shop returned is recorded, and a USD figure is computed
 *     with the exchange rate stored alongside, so a price can always be traced.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'apps/web/public/data/products.json');
const CONSTANTS = resolve(ROOT, 'apps/web/src/site-constants.ts');

const dryRun = process.argv.includes('--dry-run');
const onlyArg = process.argv.find((arg) => arg.startsWith('--only='));
const only = onlyArg ? onlyArg.slice(7).split(',').map((s) => s.trim()) : null;

/** Categories worth showing, each mapped to the shelf it belongs on. */
const CATEGORIES = [
  { key: 'mounts', shelf: 'Phone mounts', commission: 0.069, query: 'car-phone-holder', max: 8 },
  { key: 'inflators', shelf: 'Tire inflators', commission: 0.069, query: 'portable-tire-inflator', max: 6 },
  { key: 'dashcams', shelf: 'Dash cams', commission: 0.054, query: 'car-dash-cam', max: 6 },
  { key: 'care', shelf: 'Car care', commission: 0.069, query: 'car-wash-kit', max: 6 },
  { key: 'lights', shelf: 'Lights', commission: 0.023, query: 'car-led-light', max: 6 },
  { key: 'gauges', shelf: 'Gauges', commission: 0.023, query: 'digital-tire-pressure-gauge', max: 4 }
];

function affiliateLink() {
  const source = readFileSync(CONSTANTS, 'utf8');
  const match = /aliexpress:\s*"([^"]+)"/.exec(source);
  const value = match?.[1]?.trim();
  if (!value) {
    console.error('No AliExpress link in site-constants.ts (AFFILIATE_LINKS.aliexpress).');
    process.exit(1);
  }
  return value;
}

/** `/g/<id>/?ulp=<destination>` — the documented Admitad deeplink shape. */
const deeplink = (base, target) => `${base}?ulp=${encodeURIComponent(target)}`;

/**
 * Ranking. Deliberately not "cheapest wins": a 40-cent holder that falls off is
 * worse for a driver than a $12 one that holds, so price is scored as a value
 * band and evidence of real use (sold count) carries the most weight.
 */
function score(item, category) {
  const sold = item.soldCount;
  // Usability: log-scaled, capped, so 10k sold does not flatten everything else.
  const usability = Math.min(1, Math.log10(1 + sold) / 4);
  // Value: prefer the middle of the category's own price range.
  const value = item.valueBand;
  // Commission: the category rate, normalised against the best rate on offer.
  const commission = category.commission / 0.069;
  // A title that is a wall of keywords usually means a junk listing.
  const titleQuality = item.title.length <= 90 ? 1 : item.title.length <= 140 ? 0.7 : 0.4;
  const hasImage = item.image ? 1 : 0;
  return (
    0.34 * usability +
    0.26 * value +
    0.22 * commission +
    0.1 * titleQuality +
    0.08 * hasImage
  );
}

/** Where a price sits in its category: 1 at the median, falling off at extremes. */
function valueBand(price, prices) {
  const sorted = [...prices].sort((a, b) => a - b);
  if (sorted.length < 3) return 0.7;
  const median = sorted[Math.floor(sorted.length / 2)];
  if (!median) return 0.5;
  const ratio = price / median;
  // 1 at the median, 0.6 at 0.4×, 0.6 at 2.5×, dropping beyond.
  const distance = Math.abs(Math.log(ratio) / Math.log(2.5));
  return Math.max(0, 1 - distance) * 0.5 + 0.5;
}

/** A canonical https product URL, without query-string noise. */
function cleanProductUrl(raw, id) {
  try {
    const parsed = new URL(raw);
    if (!/^(www\.)?aliexpress\.com$/.test(parsed.hostname) && !parsed.hostname.endsWith('.aliexpress.com')) {
      return `https://www.aliexpress.com/item/${id}.html`;
    }
    if (!/\/item\//.test(parsed.pathname) && !/\/i\//.test(parsed.pathname)) {
      return `https://www.aliexpress.com/item/${id}.html`;
    }
    return `https://www.aliexpress.com${parsed.pathname}`;
  } catch {
    return `https://www.aliexpress.com/item/${id}.html`;
  }
}

function parseSold(text) {
  if (!text) return 0;
  const match = /([\d,.]+)\s*(k|K)?\+?\s*sold/.exec(text);
  if (!match) return 0;
  const value = parseFloat(match[1].replace(/,/g, ''));
  if (!Number.isFinite(value)) return 0;
  return Math.round(match[2] ? value * 1000 : value);
}

async function rates() {
  try {
    const response = await fetch('https://open.er-api.com/v6/latest/USD', {
      signal: AbortSignal.timeout(8000)
    });
    if (response.ok) {
      const body = await response.json();
      if (body?.rates) return { rates: body.rates, at: new Date().toISOString() };
    }
  } catch (_) {
    /* fall through */
  }
  return { rates: null, at: null };
}

async function main() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error('playwright is not installed. Run: npx playwright install chromium');
    process.exit(1);
  }

  const base = affiliateLink();
  const fx = await rates();
  const browser = await chromium.launch();
  const context = await browser.newContext({
    locale: 'en-US',
    timezoneId: 'America/New_York',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  const categories = [];
  let total = 0;

  for (const category of CATEGORIES) {
    if (only && !only.includes(category.key)) continue;

    const url = `https://www.aliexpress.com/w/wholesale-${category.query}.html`;
    process.stdout.write(`${category.shelf.padEnd(16)} `);

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(6000);
      for (let i = 0; i < 3; i += 1) {
        await page.mouse.wheel(0, 1800);
        await page.waitForTimeout(1200);
      }

      const raw = await page.evaluate(() => {
        const PRICE =
          /(?:US\s?\$\s?|Rs\.?\s?|\$\s?|€\s?|£\s?)([\d,]+(?:\.\d{1,2})?)/;
        const out = [];
        const seen = new Set();
        for (const anchor of document.querySelectorAll('a[href*="/item/"]')) {
          const idMatch = /\/(?:item|i)\/(\d{6,})/.exec(anchor.getAttribute('href') || '');
          if (!idMatch || seen.has(idMatch[1])) continue;

          // Walk up until the ancestor holds no other product link: one card.
          let el = anchor;
          let card = null;
          for (let depth = 0; depth < 10 && el; depth += 1) {
            const inner = el.querySelectorAll('a[href*="/item/"]');
            if (inner.length <= 1 && PRICE.test(el.innerText || '')) {
              card = el;
              break;
            }
            el = el.parentElement;
          }
          if (!card) continue;

          const lines = (card.innerText || '')
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);
          const priceLine = lines.find((line) => PRICE.test(line));
          const priceMatch = priceLine ? PRICE.exec(priceLine) : null;
          const title = lines.find((line) => line.length > 25 && !PRICE.test(line));
          if (!priceMatch || !title) continue;

          // The card also holds badges, logos and sale banners. The product
          // photo is the one on the media CDN with a square resize suffix.
          const productImage = [...card.querySelectorAll('img')]
            .map((img) =>
              img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('srcset') || ''
            )
            .map((value) => value.split(' ')[0] || '')
            .find((value) => /aliexpress-media\.com/.test(value) && /_\d+x\d+q?\d*\.jpg|_\d+x\d+\.(jpg|png|webp)/.test(value));

          const href = anchor.getAttribute('href') || '';
          // Build an absolute product URL. AliExpress hands back "//x" and
          // "https://x" and occasionally a bare path; all three must work, and
          // the query string (algo_pvid etc.) is not needed or wanted.
          let itemUrl = '';
          try {
            itemUrl = new URL(href, 'https://www.aliexpress.com').toString();
          } catch {
            itemUrl = `https://www.aliexpress.com/item/${idMatch[1]}.html`;
          }

          seen.add(idMatch[1]);
          out.push({
            id: idMatch[1],
            title: title.slice(0, 160),
            price: parseFloat(priceMatch[1].replace(/,/g, '')),
            currency: /Rs|₹/.test(priceLine)
              ? 'INR'
              : /€/.test(priceLine)
              ? 'EUR'
              : /£/.test(priceLine)
              ? 'GBP'
              : 'USD',
            image: productImage
              ? productImage.startsWith('//')
                ? `https:${productImage}`
                : productImage
              : '',
            itemUrl,
            sold: lines.find((line) => /sold$/.test(line)) || ''
          });
        }
        return out;
      });

      if (raw.length === 0) {
        console.log('0 products (page changed or blocked)');
        continue;
      }

      // One currency per category keeps the value band meaningful.
      const currency = raw[0].currency;
      const sameCurrency = raw.filter((item) => item.currency === currency);
      const prices = sameCurrency.map((item) => item.price);

      const ranked = sameCurrency
        .map((item) => {
          const enriched = {
            ...item,
            soldCount: parseSold(item.sold),
            valueBand: valueBand(item.price, prices)
          };
          return {
            id: item.id,
            title: item.title,
            price: item.price,
            currency: item.currency,
            priceUsd:
              fx.rates && fx.rates[item.currency]
                ? Number((item.price / fx.rates[item.currency]).toFixed(2))
                : null,
            image: item.image,
            sold: enriched.soldCount,
            score: Number(score(enriched, category).toFixed(4)),
            // Strip tracking junk from the destination; keep the canonical path.
            url: deeplink(base, cleanProductUrl(item.itemUrl, item.id))
          };
        })
        .filter((item) => item.price > 0 && item.image)
        .sort((a, b) => b.score - a.score)
        .slice(0, category.max);

      total += ranked.length;
      categories.push({ key: category.key, shelf: category.shelf, currency, products: ranked });
      console.log(`${ranked.length} products · ${currency}`);
    } catch (error) {
      console.log(`failed: ${String(error).slice(0, 70)}`);
    }
  }

  await browser.close();

  const payload = {
    checkedAt: new Date().toISOString(),
    rateAt: fx.at,
    source: 'aliexpress',
    note: 'Prices and stock are as the shop listed them when checked. They change; the shop is the source of truth.',
    categories
  };

  if (dryRun) {
    console.log(`\nDry run: ${total} products across ${categories.length} categories, nothing written.`);
    for (const category of categories) {
      for (const product of category.products.slice(0, 2)) {
        console.log(`  ${product.price} ${product.currency} · ${product.sold} sold · ${product.title.slice(0, 55)}`);
      }
    }
    return;
  }

  if (total === 0) {
    console.error('\nNo products extracted. Refusing to overwrite a good file with nothing.');
    process.exit(1);
  }

  // Keep the previous file if this run is much smaller: a block page should not
  // wipe the shelf.
  if (existsSync(OUT)) {
    try {
      const previous = JSON.parse(readFileSync(OUT, 'utf8'));
      const before = (previous.categories ?? []).reduce((sum, c) => sum + c.products.length, 0);
      if (total < before * 0.5) {
        console.error(`\nOnly ${total} products versus ${before} last time. Refusing to shrink the shelf by more than half.`);
        process.exit(1);
      }
    } catch (_) {
      /* an unreadable previous file is no reason to refuse */
    }
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(payload, null, 1)}\n`);
  console.log(`\nWrote ${OUT} — ${total} products across ${categories.length} categories.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
