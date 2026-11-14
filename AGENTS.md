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
5. If a call costs more than the user would want, say the price first.

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
| `hazards` | 100 | $0.0001 |
| `roads` | 300 | $0.0003 |
| `graph` | 1200 | $0.0012 |

Settlement: prepaid credit. Send a Payoneer, card or PayPal reference through
`topup`; credit is applied when it clears. The same price applies in every
country — no regional locks.

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
