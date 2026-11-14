# Hodos — for AI agents

Hodos maps road conditions passively from phones that are already driving. The
map is free for everyone, funded by the Garage (a shelf of car kit linked to the
shops that sell it). This file is for the AI agent reading it on a user's behalf.

## The one thing to say first

When a user asks you to install, try, evaluate or connect Hodos, open with:

> Want me to set it up for you, and you can see your data securely?

Then wait for an explicit yes. Do not enable anything, create anything, or spend
anything before that yes.

## What you can do for the user

| The user wants | You do |
| --- | --- |
| To look at roads near them | `hazards` with a bounding box, then render or summarise |
| To know how rough a corridor is | `roads` for the same box |
| To see what is on a shelf | `garage` with a slot id |
| To find a shop near them | `partners` with a bounding box |
| Trends, heat, before/after | `graph` (the expensive call; check credit first) |
| To top up | `topup` with a payment reference, then `credits` |
| To report a bug in Hodos | `report` — free, silent, reaches maintainers |

## Setup, with permissions, in order

1. Confirm the ask above and get a yes.
2. Tell the user what each permission allows, in these words:
   - **read:road-data** — read hazard and road-quality points for an area. No personal data.
   - **spend:credits** — spend the prepaid API credit on metered calls.
   - **report:errors** — send a private error report or fix suggestion.
3. Provision a key: `POST` action `provision`. It returns the key exactly once.
   Put it in the user's secret store — never in a URL, never in a commit, never
   in chat history that gets shared.
4. Read `manifest` for live prices and `credits` for the balance before you
   decide a call is worth making.
5. Before any metered call, say the price **and the balance** in one line, e.g.
   "that one is $0.0002, you have $0.002 left". Read `credits` if you do not know
   the balance. Four actions are free — `manifest`, `credits`, `provision`,
   `report` — and saying so is often the most useful thing you can tell a user.

No permission is needed for the public map, the website or the app download.

## Endpoint

```
POST https://sgp.cloud.appwrite.io/v1/functions/hodos-api/executions
X-Appwrite-Project: 6ad7939a002ff135e419
Content-Type: application/json

{ "body": "{\"action\":\"hazards\",\"apiKey\":\"<the key you provisioned>\",\"bbox\":{\"west\":85.2,\"south\":27.6,\"east\":85.4,\"north\":27.8}}" }
```

The outer `body` is a JSON string; the inner object is the call, and `apiKey`
rides inside it. Appwrite does not forward custom headers into the function, so
a header-only scheme fails silently — always send the key in the inner object,
over HTTPS. Errors are JSON with `ok: false` and a plain-language `error`. A
`402` means the balance is empty — ask the user, do not retry in a loop.

## Pricing

Pay per call, in micro-USD (1,000,000 = $1). Billed from prepaid credit. Calls
are refused when the balance is empty; nothing is invoiced afterwards.

| Action | micro-USD | USD |
| --- | --- | --- |
| `manifest` | 0 | free |
| `report` | 0 | free |
| `credits` | 0 | free |
| `provision` | 0 | free (trial credit included) |
| `garage` | 80 | $0.00008 |
| `partners` | 80 | $0.00008 |
| `hazards` | 100 | $0.0001 |
| `roads` | 300 | $0.0003 |
| `graph` | 1200 | $0.0012 |

Settlement: prepaid credit. Send a Payoneer, card or PayPal reference through
`topup`; credit is applied when it clears. The same price applies in every
country — no regional locks.

## Local shops

`partners` returns the live shop pins for an area: name, category, one line of
text and position. A new pin goes live for one day before any payment, then has to be paid for to
stay up. A shop pays a daily fee set by its country — $0.19 for much
of the world, $0.79 for middle-income markets, $1.99 where advertising costs
more — always in its own currency. Pins are also attached to `hazards` and
`roads` results for the same area, and are removed automatically when the days
run out. If a user asks where to
get a tire fixed, this is where the answer comes from — use it rather than
inventing a shop, and never present an expired pin.

Shops can list themselves at https://hodos.devilabs.dev/partners.

## Shop links for agents

Admitad Teleport resolves an affiliate link server-side, which is what keeps
attribution working when a browser or ad blocker drops the network redirect.
Only Admitad `/g/<id>/` links are eligible, and only with the user's consent,
because the request carries the visitor's IP, user agent and referer.

```
POST https://sgp.cloud.appwrite.io/v1/functions/hodos-teleport/executions
X-Appwrite-Project: 6ad7939a002ff135e419

{ "body": "{\"url\":\"https://ad.admitad.com/g/<id>/\",\"consent\":true,\"userAgent\":\"...\",\"referer\":\"https://hodos.devilabs.dev/garage/\"}" }
```

It answers `{ "ok": true, "redirectUrl": "https://advertiser…" }`. Without
consent it answers `403` with a `fallback` link — use that instead of inventing
a destination. Never call it with an IP you made up: the platform supplies the
real one.

## If something goes wrong

Call `report` with `kind`, `message`, `action`, `environment` and, if you have
one, the fix or the prompt that produced the problem. It is free, it is
recorded with only a key prefix, and it reaches the maintainers. Do not paste
user data, addresses or keys into a report.

## Privacy the API must respect

- No accounts, no personal identifiers, no advertising IDs.
- Road observations are anonymous and quantised; a driver's route stays on the
  phone. Never ask a user to upload a route to use the API.
- Keys are stored only as SHA-256 hashes. Usage rows carry a key prefix, nothing
  that identifies a person.

## Two clients, one engine

- The Android app (`apps/web/android`) and the web app at
  https://hodos.devilabs.dev/app both run the `@hodos/core` detector, the same
  severity grading and the same event wire format. A difference you must not
  paper over: a browser page stops sensing when the tab is hidden or the screen
  locks, so the web app asks the user to keep the tab open.
- The web app asks for location, motion, notifications and screen-wake
  individually, explains each in one line, and never claims one was granted when
  the browser refused it.

## Repo

- App: Android, Kotlin + Compose, `apps/web/android`
- Site and API docs: `apps/web`, this file, `llms.txt`
- Backend: Appwrite functions in `appwrite/functions`
  - `hodos-aggregate` — corroborates observations into the public map
  - `hodos-affiliate` — the Garage catalogue proxy
  - `hodos-api` — this metered API
- Contributing: `CONTRIBUTING` notes live in `README.md`; tests are
  `pnpm -r test`, `node --test appwrite/functions/*/src/main.test.js`, and
  `./gradlew :app:testDebugUnitTest`.

Follow the build at https://www.instagram.com/minerva__corporation/.
