const test = require("node:test");
const assert = require("node:assert/strict");
// Tests never touch the live catalogue or the backend.
process.env.APPWRITE_FUNCTION_API_ENDPOINT = "https://hodos-test.invalid/v1";
process.env.APPWRITE_FUNCTION_PROJECT_ID = "test-project";
process.env.APPWRITE_FUNCTION_API_KEY = "test-key-not-secret";
process.env.CHANNEL3_API_KEY = "test-channel3-key";

const affiliate = require("./main.js");
const { testing } = affiliate;

function product(overrides = {}) {
  return {
    id: "prod_1",
    title: "12V Tire Inflator",
    brands: [{ id: "b1", name: "Viair" }],
    images: [{ url: "https://cdn.example.com/a.jpg", is_main_image: true }],
    offers: [
      {
        url: "https://buy.example.com/a",
        domain: "example.com",
        price: { price: 49.99, currency: "USD", compare_at_price: 59.99 },
        availability: "InStock",
        max_commission_rate: 0.04
      }
    ],
    ...overrides
  };
}

test("only whitelisted slots are addressable", () => {
  assert.ok(testing.slotNames().includes("inflator"));
  assert.ok(testing.slotNames().includes("mount"));
  assert.equal(testing.slotNames().includes("anything"), false);
});

test("accepts plausible addresses and rejects malformed ones", () => {
  assert.equal(testing.validEmail("driver@example.com"), true);
  assert.equal(testing.validEmail("  Driver@Example.COM "), true);
  for (const value of ["", "no-at", "a@b", "a@b.c", "@example.com", null, 42]) {
    assert.equal(testing.validEmail(value), false);
  }
});

test("normalises addresses before they are stored", () => {
  assert.equal(testing.normaliseEmail("  Driver@Example.COM "), "driver@example.com");
});

test("prefers the best commission, then the cheapest offer", () => {
  const ranked = testing.bestOffer({
    offers: [
      { url: "https://a.example/x", price: { price: 20, currency: "USD" }, max_commission_rate: 0 },
      { url: "https://b.example/x", price: { price: 40, currency: "USD" }, max_commission_rate: 0.05 },
      { url: "https://c.example/x", price: { price: 30, currency: "USD" }, max_commission_rate: 0.05 }
    ]
  });
  assert.equal(ranked.url, "https://c.example/x");

  const noCommission = testing.bestOffer({
    offers: [
      { url: "https://a.example/x", price: { price: 25, currency: "USD" }, max_commission_rate: 0 },
      { url: "https://b.example/x", price: { price: 20, currency: "USD" }, max_commission_rate: 0 }
    ]
  });
  assert.equal(noCommission.url, "https://b.example/x");
});

test("ignores offers without an https link, a price, or stock", () => {
  const offer = testing.bestOffer({
    offers: [
      { url: "http://insecure.example/x", price: { price: 10, currency: "USD" } },
      { url: "https://no-price.example/x" },
      { url: "https://sold-out.example/x", price: { price: 10, currency: "USD" }, availability: "OutOfStock" }
    ]
  });
  assert.equal(offer, null);
});

test("shapes a product into a card", () => {
  const card = testing.shapeProduct(product());
  assert.deepEqual(card, {
    id: "prod_1",
    title: "12V Tire Inflator",
    brand: "Viair",
    image: "https://cdn.example.com/a.jpg",
    price: 49.99,
    compareAt: 59.99,
    currency: "USD",
    merchant: "example.com",
    url: "https://buy.example.com/a"
  });
});

test("drops products that cannot be bought and dedupes by id", () => {
  const cards = testing.shapeProducts([
    product(),
    product(),
    product({ id: "prod_2", offers: [] }),
    product({ id: "prod_3", offers: [{ url: "https://x.example/x", price: { price: 5 } }], images: [] })
  ]);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].id, "prod_1");
  assert.equal(cards[1].id, "prod_3");
  assert.equal(cards[1].image, null);
});

test("caps a slot at eight cards", () => {
  const many = Array.from({ length: 20 }, (_, i) => product({ id: `prod_${i}` }));
  assert.equal(testing.shapeProducts(many).length, 8);
});

test("treats unparseable bodies as an empty request", () => {
  assert.deepEqual(testing.parseBody("not json"), {});
  assert.deepEqual(testing.parseBody(""), {});
  assert.deepEqual(testing.parseBody('{"slot":"mount"}'), { slot: "mount" });
});
