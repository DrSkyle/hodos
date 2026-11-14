import {
  checkedLabel,
  loadShelf,
  priceFor,
  shelfFor,
  soldLabel,
  visitorCurrency,
  type Product
} from "./products";
import { visitorCountry } from "./offers";

/**
 * Product shelves on the landing page.
 *
 * Real products, real prices, real sold counts, each with a tracked link. The
 * list rotates per day and per market, so the shelf stays useful without being
 * the same six rows forever, and the prices carry the date they were checked.
 */

const host = document.getElementById("product-shelves");
const status = document.getElementById("product-shelves-status");

function card(product: Product, currency: string): HTMLElement {
  const link = document.createElement("a");
  link.className = "product-card";
  link.href = product.url;
  link.rel = "sponsored noopener noreferrer";
  link.target = "_blank";

  const price = priceFor(product, currency);
  const bought = soldLabel(product.sold);

  link.innerHTML = `
    <span class="product-card-thumb">
      ${product.image ? `<img src="" alt="" loading="lazy" referrerpolicy="no-referrer" />` : ""}
    </span>
    <span class="product-card-body">
      <span class="product-card-title"></span>
      <span class="product-card-meta">
        <strong class="product-card-price"></strong>
        ${bought ? `<span class="product-card-sold"></span>` : ""}
      </span>
    </span>
  `;

  // Set text and attributes without innerHTML, so a shop's title can never
  // introduce markup into our page.
  const image = link.querySelector("img");
  if (image) image.src = product.image;

  const title = link.querySelector(".product-card-title");
  if (title) title.textContent = product.title;

  const priceNode = link.querySelector(".product-card-price");
  if (priceNode) priceNode.textContent = price.amount;

  const sold = link.querySelector(".product-card-sold");
  if (sold) sold.textContent = bought;

  if (price.original) {
    link.title = `Shop lists this at ${price.original}`;
  }

  return link;
}

async function render() {
  if (!host) return;

  const data = await loadShelf();
  if (!data) {
    host.replaceChildren();
    if (status) status.textContent = "The shelf is unavailable right now.";
    return;
  }

  const country = visitorCountry();
  const currency = visitorCurrency();
  const shelves = shelfFor(data, 4, country);

  host.replaceChildren();

  for (const shelf of shelves) {
    const section = document.createElement("div");
    section.className = "product-shelf";

    const head = document.createElement("div");
    head.className = "product-shelf-head";
    const name = document.createElement("h3");
    name.textContent = shelf.shelf;
    const stamp = document.createElement("span");
    stamp.className = "product-shelf-stamp";
    stamp.textContent = `checked ${checkedLabel(shelf.checkedAt)}`;
    head.append(name, stamp);

    const row = document.createElement("div");
    row.className = "product-row";
    for (const product of shelf.products) row.append(card(product, currency));

    section.append(head, row);
    host.append(section);
  }

  if (status) {
    status.textContent =
      country === "IN"
        ? "Live prices from AliExpress · India"
        : "Live prices from AliExpress";
  }
}

void render();
