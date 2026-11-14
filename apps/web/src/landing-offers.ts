import { offersFor, visitorCountry, type Offer } from "./offers";

/**
 * Partner shops on the landing page.
 *
 * Rendered from the same list the Garage and the API use, so the front page
 * cannot drift from what actually works. Ordered for whoever is reading: a
 * visitor in India sees Indian shops first, a visitor in Estonia sees the EU
 * compensation claim, everyone sees car kit and travel.
 */

const host = document.getElementById("partner-strip");
const status = document.getElementById("partner-strip-status");

function card(offer: Offer): HTMLElement {
  const link = document.createElement("a");
  link.className = "partner-card";
  link.href = offer.url;
  link.rel = "sponsored noopener noreferrer";
  link.target = "_blank";

  const category = document.createElement("span");
  category.className = "partner-card-cat";
  category.textContent = offer.category;

  const name = document.createElement("strong");
  name.textContent = offer.name;

  const blurb = document.createElement("span");
  blurb.className = "partner-card-blurb";
  blurb.textContent = offer.blurb;

  const go = document.createElement("span");
  go.className = "partner-card-go";
  go.textContent = "Visit ↗";

  link.append(category, name, blurb, go);
  return link;
}

if (host) {
  const country = visitorCountry();
  const offers = offersFor(country);
  host.replaceChildren();
  for (const offer of offers) host.append(card(offer));

  if (status) {
    if (offers.length === 0) {
      status.textContent = "No partner shops configured yet.";
    } else {
      const local = offers.filter((offer) => offer.regions?.includes(country)).length;
      status.textContent =
        local > 0
          ? `${offers.length} partner shops · ${local} local to you`
          : `${offers.length} partner shops`;
    }
  }
}
