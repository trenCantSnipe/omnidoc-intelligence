# Hotel Operations Intelligence

An intelligence layer that sits **on top of** a hotel's existing PMS, OTAs, accounting and utility
systems. It does not replace them. It watches what they emit, works out what *changed*, whether it is
*unusual for this hotel*, whether it *matters*, what to *do*, and who needs to *know*.

> The LLM is the interface, not the product. Everything below the narrator is deterministic,
> tested, and explainable; the model only phrases results the engines already computed.

```
npm install
npm test            # 62 tests
npm run typecheck
npm run demo        # onboards a simulated 80-room hotel and prints the morning brief
npm run demo -- --llm   # same, narrated by Claude (needs ANTHROPIC_API_KEY)
```

## What the demo shows

A simulated hotel is onboarded through the real adapter path (CSV exports for history, PMS webhooks,
IoT meter readings and a rate-shop feed for the latest day). Baselines are learned from 120 days, then
one day with three injected stories is analysed. The brief it produces (abridged):

```
4 items need attention, 2 critical. Top: Cancellation rate 20% vs 6% normal.

Cancellations  [critical] 9 cancellations vs ~2 expected for 46 bookings … largest source: booking.com (8 of 9)
Operational    [critical] Electricity 5,821 kWh, 45% above the 4,015 kWh this hotel normally uses at this
                          level of occupancy (+57% vs a typical Sunday, while occupancy was +12%) … ≈ ₹16,256 excess
Pricing        [important] Strong demand for Deluxe: 22 bookings vs ~10 typical (2.2×); 3 competitors raised
                          rates (avg +8%); only 16% of next-week inventory unsold
Actions        1. Investigate the cancellation spike  2. Investigate unexplained electricity consumption
               3. Raise Deluxe rates 6–10% — from ₹6,500 to ₹7,000 (+7.7%)
```

…and routes it: Operations is pushed the electricity anomaly and never sees pricing; the Revenue Manager
gets the pricing opportunity in their inbox; the GM is pushed only the critical items.

## Architecture

```
 PMS / OTA / meters / CSV  →  integration/   adapters → normalized Observations
                              platform.ts    ingest (idempotent) ─┐
                              detection/     change detector → events (+ "is this event meaningful?")
                              store/         event log · daily metric series · versioned market state
                              baseline/      "normal for THIS hotel": weekday seasonality + driver regression
                              anomaly/       statistical gate AND operational-significance gate
                              context/       signals → situations (strong demand, energy, cancellations…)
                              decision/      situations → recommendations → approval → action (guard-railed)
                              ranking/       business-impact score → tier → role routing → anti-flood
                              briefing/ copilot/ memory/    the human-facing layer
```

| Spec area | Where | Notes |
|---|---|---|
| Integration layer | `src/integration` | `SourceAdapter` = one pure `parse()`; CSV adapters with configurable columns, PMS-webhook / IoT / rate-shop JSON examples, HMAC webhook verification, registry |
| Event detection | `src/detection` | `PRICE_CHANGED`, `COMPETITOR_PRICE_CHANGED`, `INVENTORY_CHANGED`, `PROMOTION_*`, `OCCUPANCY_CHANGED`, `ROOM_BOOKED/CANCELLED`, plus anomaly events (`ELECTRICITY_SPIKE`, `REVENUE_ANOMALY`, `CANCELLATION_SPIKE`, `ROOM_CATEGORY_SELLING_FAST/SLOW`, …). Each event is classified `noise → major` |
| Historical baselines | `src/baseline` | Recency-weighted weekday medians (robust to past incidents), pooled-variance shrinkage, special-day handling, **robust regression on same-day drivers** (electricity ~ rooms sold), log-scale for lumpy costs |
| Anomaly detection | `src/anomaly` | Actionable only if **statistically unusual (z) AND operationally large enough** (per-metric effect size) AND in the harmful direction |
| Contextual reasoning | `src/context` | Combines pickup, occupancy, competitor moves, inventory into situations with per-signal evidence; revenue gap decomposed into volume vs rate |
| Pricing intelligence | `src/decision` | Transparent heuristic (pace × scarcity × market), ceilings, 15% single-move cap, parity and undercut checks |
| Recommendation → approval → action | `src/decision/approval.ts` | Human approval by default, audit trail, pluggable `ActionExecutor` (dry-run default), opt-in automation rules with hard limits |
| Intelligent alerting | `src/ranking` | Impact relative to a normal day's revenue, urgency caps, role-aware routing (push / inbox / brief), cooldowns for standing conditions |
| Daily briefing | `src/briefing` | Ordered by impact, role-specific, "watching" list, transparency footer |
| Copilot | `src/copilot` | Intent routing to deterministic analyses; optional `AnthropicNarrator` rephrases using only those facts and falls back to the draft on any error/refusal |
| Historical memory | `src/memory` | Episode recall ("last time occupancy hit 90%"), similar situations, action-outcome evaluation |

## Design decisions worth knowing

- **Two gates, not one.** A 30% swing in a metric that normally moves 40% is noise; a 6% swing in a metric
  that never moves is not worth a human's time. Both are tested separately.
- **Explain relative to drivers.** "Electricity +45%" is useless; "+45% *for this occupancy*" is a finding.
- **Composite situations tolerate weak signals, standalone alerts don't.** A *watch*-level pickup (2σ) can
  corroborate a demand surge alongside competitor moves and low inventory, but never alerts by itself.
- **Count-based cancellation test.** Alerting is on cancellations *given today's bookings* (Poisson-aware), not on
  the raw rate, which swings on low-volume days. The rate is still shown as a KPI.
- **Idempotent ingestion.** Webhook retries and re-imported exports don't double-count bookings or meter readings.
- **Time-travel state.** Rates/inventory are versioned, so replaying history sees the market as it was that day.
- **Missing data is not zero.** A day with no reservation feed derives no booking metrics, so an outage doesn't
  look like a collapse in demand.
- **Nothing acts without permission.** The default executor is a dry-run; automation is opt-in per action type,
  with a max change %, confidence floor, category scope and increases-only option.

## Measured quality (simulated data)

On 3 months × several seeds of **anomaly-free** operations, surfaced alerts average ≈0.11/day with ≈1 critical
every ~90 days (asserted in `test/platform.test.ts`: < 0.25/day, < 0.03 critical/day). Getting there found and fixed real
problems (persisting parity gap re-alerting every 2 days, watch-level deviations becoming alerts, low-volume
cancellation-rate noise, heavy-tailed maintenance costs). The injected scenarios (strong Deluxe demand, +43% electricity at
constant occupancy, cancellation spike) are all detected.

**Caveat:** these numbers come from a simulator written by the same author as the detectors. They show the
mechanics work and that the quiet-when-normal property holds; they are *not* a claim about accuracy on a real
hotel. Thresholds (`zActionable=3`, per-metric effect sizes in `baseline/metricSpecs.ts`) must be tuned on real history.

## Not built yet (honest list)

- **Persistence.** Stores are in-memory behind small interfaces (`EventStore`, `MetricStore`, `StateStore`); swap in a
  database/stream for production. No multi-tenant auth or per-hotel isolation yet.
- **Real vendor adapters.** Generic CSV + example PMS/meter/rate-shop JSON mappings only. Each real PMS/channel manager
  needs its own mapping (small by design) and credentials handling.
- **Data collection.** Competitor/OTA rate *collection* (scraping/rate-shopping APIs), weather and local-event feeds are
  inputs the platform consumes; it does not gather them. Only a holiday/event calendar is modelled as context today.
- **Daily-close analysis.** Anomalies are evaluated per business day. Intraday/streaming evaluation (partial-day
  expectations) is the natural next step; change *events* are already real-time.
- **Forecasting.** Demand/revenue forecasting, cancellation prediction, elasticity learning, predictive maintenance:
  the history and outcome tracking exist, the models don't. Pricing uses a transparent heuristic, not a learned model.
- **Delivery channels.** Routing decides *who gets what and how urgently*; WhatsApp/Slack/Teams/email senders are not wired.
- **Live LLM path.** `AnthropicNarrator` is unit-tested with a fake client (success, error, refusal, empty). It has
  **not** been run against the live API in this environment (no key); the deterministic path is what the tests and demo exercise.
