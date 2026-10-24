# How Hodos could earn

## Start from the truth

The hazard data is effectively free. Anyone who can see the map can rebuild the
list, and a licence in Kathmandu is a piece of paper nobody will litigate. So any
plan that begins "we own the data" begins with nothing.

That is not a problem, it is a clarification. **If the data is free, the data was
never the product.** What is actually scarce:

- **Coverage.** Nobody else has driven these roads with phones running. Getting
  the first thousand kilometres in a ward is work, and it is not in the file you
  downloaded.
- **Verification.** Saying "there is a pothole here" is cheap. Saying "and it is
  still there as of Tuesday, and here is what supports that" is worth money to
  someone who has to act on it.
- **The workflow.** A municipality does not want a map. It wants a worklist in a
  format its engineer can act on, inside the process it already runs.
- **A name.** When a report goes into a ward meeting and someone asks "who says",
  the answer has to be an organisation that will stand behind it.

A competitor can copy the dataset in an afternoon and still have to do all four.
That is the moat, and it is the only one available here.

## Where the money actually is, best first

### 1. Repair verification — the strongest idea

The person who pays is the person paying **for the repairs**, not the person
doing them: the ward, the municipality, a donor programme. What they cannot
currently buy is assurance.

Hodos can say, with evidence:

> This stretch was patched in Baisakh. Since then 9 independent phones have
> travelled it and none detected the defect. Two defects on the same road were
> re-detected within a month of being "repaired".

That is a monitoring product. It uses exactly the mechanism already built —
`clearPasses` for verified repairs, fresh impacts for repairs that failed — and
it sells to the **payer**, never to the contractor being checked. This is the one
thing here that a spreadsheet cannot clone, because it depends on continuous
passive coverage, which is the hard part.

### 2. A managed service to wards and municipalities

Not software — a service. Monthly, per ward: the prioritised worklist, the
verification note, the export in their format, and a person to call. They have
road budgets and small discretionary funds; this is operational spend, not IT
spend, which is why it is sellable at a ward level without procurement.

Price it against one avoided complaint cycle, not against software.

### 3. Fleets, transport operators and ride-hailing

Buses, trucks and delivery fleets pay for suspension damage, tyres and downtime.
Ride-hailing and scooter-rental operators have riders on bad roads and care about
both vehicles and complaints. They can buy an aggregate route-risk view. Sell the
**aggregate**, never a trace, never a device.

### 4. Donors and road-safety programmes

Road safety is a funded category, and funded programmes expect reporting
standards. Coverage in a named corridor, with verifiable before/after evidence,
is exactly the kind of deliverable a programme can pay for — and unlike a
municipality, a donor will accept an open-data clause.

### 5. Insurance

Later, and only at aggregate level. Vehicle and two-wheeler insurers care about
where claims come from. This is a real market but a slower, more regulated one.

## What to keep back — friction, not enforcement

Since enforcement is fantasy, use friction:

- **The map stays free.** That is non-negotiable; it is why people contribute and
  why the data is credible.
- **Do not ship a bulk dump as the product.** Export exists for a ward that is
  being served, not as a public download. Anyone determined can scrape the map,
  but the organisation that wants to *act* on the data wants the verified report
  and someone accountable for it.
- **Put the report behind an agreement that names the ward.** Not to stop
  copying — to create a paper trail that establishes who the source is. In a
  market where nobody enforces licences, being the recognised origin is worth
  more than a clause.

## The honest fallback

It is entirely possible this never becomes a business, and that is a legitimate
outcome. A civic map that a ward uses to get roads fixed is a public good, and
public goods are funded by grants, CSR, university programmes and donors — not by
customers. Plenty of the most useful infrastructure in Nepal works this way.

The mistake is pretending it is a startup. The alternative mistake is assuming it
cannot earn at all. Both are avoidable: build the thing, get one ward to use one
report, and let the answer come from that.

## The line

- **Never** sell location traces, device identifiers, or anything that identifies
  a person or a journey. That is the only reason people contribute.
- **No advertising** in the app. A civic map that is also an ad surface loses the
  trust that makes it useful.
- **Never sell to the party being monitored while selling to the party paying for
  the monitoring.** There is no version of that which ends well.

The privacy model is not a constraint on earning. It is the credibility that
makes earning possible at all.
