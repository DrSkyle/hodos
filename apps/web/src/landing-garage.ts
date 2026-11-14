import {
  DEFAULT_GARAGE_SLOT_ID,
  loadOffers,
  money,
  offerMeta,
  wasPrice,
  type GearOffer
} from "./garage-client";

/**
 * Landing-page shelf preview.
 *
 * The Garage is the front door, so the hero shows real products from the same
 * backend the /garage page uses. Nothing is hard-coded: if the catalogue is
 * unreachable the panel says so rather than showing invented items.
 */

const host = document.getElementById("hero-shelf");
const status = document.getElementById("hero-shelf-status");

function skeleton() {
  if (!host) return;
  host.replaceChildren();
  for (let i = 0; i < 3; i += 1) {
    const bar = document.createElement("div");
    bar.className = "offer-skeleton";
    bar.style.height = "58px";
    host.append(bar);
  }
}

function row(offer: GearOffer): HTMLElement {
  const item = document.createElement("a");
  item.className = "shelf-row";
  item.href = offer.url;
  item.target = "_blank";
  item.rel = "sponsored noopener noreferrer";

  if (offer.image) {
    const image = document.createElement("img");
    image.className = "shelf-thumb";
    image.src = offer.image;
    image.alt = "";
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    item.append(image);
  }

  const body = document.createElement("div");
  body.className = "shelf-copy";

  const title = document.createElement("span");
  title.className = "shelf-title";
  title.textContent = offer.title;
  body.append(title);

  const meta = document.createElement("span");
  meta.className = "shelf-meta";
  meta.textContent = offerMeta(offer);
  body.append(meta);

  item.append(body);

  const price = document.createElement("span");
  price.className = "shelf-price";
  price.textContent = money(offer.price, offer.currency);
  const before = wasPrice(offer);
  if (before) {
    const was = document.createElement("s");
    was.textContent = before;
    price.append(was);
  }
  item.append(price);

  return item;
}

function setStatus(text: string, tone: "idle" | "error" = "idle") {
  if (!status) return;
  status.textContent = text;
  status.dataset.tone = tone;
}

async function load() {
  if (!host) return;
  skeleton();
  setStatus("Reading the shelf…");
  try {
    const offers = await loadOffers(DEFAULT_GARAGE_SLOT_ID);
    host.replaceChildren();
    if (offers.length === 0) {
      setStatus("The shelf is empty right now.");
      return;
    }
    for (const offer of offers.slice(0, 3)) host.append(row(offer));
    setStatus("Live prices from the shops");
  } catch (_) {
    host.replaceChildren();
    setStatus("The shelf is unreachable right now.", "error");
  }
}

void load();
