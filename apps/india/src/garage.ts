import "./cartographic.css";
import "./garage.css";
import "./pwa";
import { loadLiveShops, type LiveShop } from "./live-shops";
import { wireThemeToggle } from "./theme";

wireThemeToggle("theme-toggle");

const grid = document.getElementById("shops-grid");
const pills = document.getElementById("category-pills");

let activeCategory = "All";
let shops: LiveShop[] = [];

function renderShops() {
  if (!grid) return;
  const filtered = activeCategory === "All"
    ? shops
    : shops.filter((s) => s.category === activeCategory);

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="nepal-empty-card">
        <h3>No live shops in this view yet</h3>
        <p>Shop pins in India are completely free initially. (289 people earned ₹2,00,000+ through Hodos — referrals are paused while pins are free for all shops.)</p>
        <div class="hero-actions" style="margin-top: 12px;">
          <a class="btn btn-primary" href="/partners">Place a free shop pin</a>
          <a class="btn btn-ghost" href="/referrals">Referral updates &amp; newsletter</a>
        </div>
      </div>
    `;
    return;
  }

  grid.innerHTML = "";
  for (const shop of filtered) {
    const card = document.createElement("article");
    card.className = "shelf-card";

    const cat = document.createElement("span");
    cat.className = "garage-eyebrow";
    cat.textContent = shop.category;

    const title = document.createElement("h3");
    title.textContent = shop.name;

    const offer = document.createElement("p");
    offer.textContent = shop.offer;

    const addr = document.createElement("p");
    addr.className = "shelf-meta";
    addr.textContent = shop.address;

    card.append(cat, title, offer, addr);
    grid.appendChild(card);
  }
}

function renderCategories() {
  if (!pills) return;
  const cats = ["All", ...Array.from(new Set(shops.map((s) => s.category)))];
  pills.innerHTML = "";
  for (const cat of cats) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "calc-plan";
    btn.textContent = cat;
    btn.setAttribute("aria-pressed", String(cat === activeCategory));
    btn.addEventListener("click", () => {
      activeCategory = cat;
      renderCategories();
      renderShops();
    });
    pills.appendChild(btn);
  }
}

void loadLiveShops()
  .then((loaded) => {
    shops = loaded;
    renderCategories();
    renderShops();
  })
  .catch(() => {
    shops = [];
    renderShops();
  });
