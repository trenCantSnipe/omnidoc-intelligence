import type { BaselineEngine } from '../baseline/baselineEngine';
import { suggestPriceMove } from '../decision/pricing';
import type { EventStore } from '../store/eventStore';
import type { MetricStore } from '../store/metricStore';
import type { StateStore } from '../store/stateStore';
import type { Anomaly, DateKey, HotelProfile, RoomCategory, Signal, Situation, SituationKind } from '../types';
import { count, formatMetric, money, mult, pct, signedPct } from '../util/format';
import { clamp, fnv1a, mean, round, sum } from '../util/stats';
import { addDays, dayEnd, dowName } from '../util/time';

const HORIZON_DAYS = 7;
const HOUR = 3_600_000;

interface CompetitorMove {
  competitor: string;
  changePct: number;
  eventId: string;
  category: string;
}

/**
 * Combines individual events and anomalies into coherent *situations*. A single anomaly is a data
 * point; "strong premium demand" is a conclusion supported by pickup, occupancy, competitor
 * movement and remaining inventory all pointing the same way. Each situation lists its supporting
 * signals with evidence, so every claim can be traced back to numbers.
 */
export class ContextEngine {
  constructor(
    private profile: HotelProfile,
    private metrics: MetricStore,
    private events: EventStore,
    private state: StateStore,
    private baseline: BaselineEngine,
  ) {}

  analyze(date: DateKey, anomalies: Anomaly[]): Situation[] {
    const live = anomalies.filter((a) => a.classification === 'actionable' || a.classification === 'watch');
    const out: Situation[] = [];
    const surgeCategories = new Set<string>();

    for (const cat of this.profile.categories) {
      const s = this.demandSurge(date, cat, live);
      if (s) {
        out.push(s);
        surgeCategories.add(cat.id);
      }
      const soft = this.demandSoftness(date, cat, live);
      if (soft) out.push(soft);
      const undercut = surgeCategories.has(cat.id) ? null : this.priceUndercut(date, cat);
      if (undercut) out.push(undercut);
      const parity = this.rateParity(date, cat);
      if (parity) out.push(parity);
    }

    const market = this.marketMove(date);
    if (market) out.push(market);

    // Watch-level deviations may corroborate a composite situation above, but never raise one alone.
    for (const a of live) {
      if (a.classification !== 'actionable') continue;
      const s = this.fromAnomaly(date, a, live);
      if (s) out.push(s);
    }
    return out;
  }

  /* -------------------------------------------------------------- *
   * helpers
   * -------------------------------------------------------------- */

  private endTs(date: DateKey): number {
    return dayEnd(date, this.profile.tzOffsetMinutes);
  }

  private id(kind: SituationKind, date: DateKey, extra = ''): string {
    return `sit_${fnv1a(`${this.profile.id}|${kind}|${date}|${extra}`)}`;
  }

  /** Share of rooms still unsold over the next week, and the unsold room-nights. */
  private forwardInventory(cat: RoomCategory, date: DateKey): { remainingShare: number; availableNights: number } | null {
    const end = this.endTs(date);
    let avail = 0;
    let total = 0;
    for (let i = 0; i < HORIZON_DAYS; i++) {
      const inv = this.state.inventoryAt(cat.id, addDays(date, i), end);
      if (inv) {
        avail += inv.available;
        total += inv.total;
      }
    }
    return total ? { remainingShare: avail / total, availableNights: avail } : null;
  }

  private competitorMoves(date: DateKey, categoryId?: string): CompetitorMove[] {
    const end = this.endTs(date);
    const latest = new Map<string, CompetitorMove>();
    for (const e of this.events.query({ types: ['COMPETITOR_PRICE_CHANGED'], fromTs: end - 48 * HOUR, toTs: end })) {
      if (categoryId && e.payload.category !== categoryId) continue;
      const change = Number(e.payload.changePct);
      if (Math.abs(change) < 5) continue;
      latest.set(`${e.payload.provider}|${e.payload.category}`, {
        competitor: String(e.payload.provider),
        changePct: change,
        eventId: e.id,
        category: String(e.payload.category),
      });
    }
    return [...latest.values()];
  }

  private compName = (id: string): string => this.profile.competitors.find((c) => c.id === id)?.name ?? id;

  private currentDirect(cat: RoomCategory, date: DateKey): number {
    return this.state.ownRateAt('own_direct', cat.id, this.endTs(date)) ?? cat.baseRate;
  }

  /* -------------------------------------------------------------- *
   * demand
   * -------------------------------------------------------------- */

  private demandSurge(date: DateKey, cat: RoomCategory, live: Anomaly[]): Situation | null {
    const pickup = live.find((a) => a.metric === `pickup:${cat.id}` && a.direction === 'up');
    if (!pickup) return null;

    const signals: Signal[] = [];
    const eventIds: string[] = [];
    const anomalyIds = [pickup.id];
    const multiple = pickup.observed / Math.max(pickup.expected, 0.5);

    signals.push({
      label: 'Booking pace',
      evidence: `${count(pickup.observed)} ${cat.name} bookings vs ~${count(pickup.expected)} typical for a ${dowName(date)} (${mult(multiple)})`,
      weight: pickup.classification === 'actionable' ? 0.3 : 0.2,
    });

    const occ = live.find((a) => a.metric === 'occupancy_pct' && a.direction === 'up');
    if (occ) {
      anomalyIds.push(occ.id);
      signals.push({ label: 'Occupancy', evidence: `${pct(occ.observed)} vs ${pct(occ.expected)} expected`, weight: 0.15 });
    }
    const bookings = live.find((a) => a.metric === 'bookings' && a.direction === 'up');
    if (bookings) {
      anomalyIds.push(bookings.id);
      signals.push({ label: 'Total bookings', evidence: `${count(bookings.observed)} bookings vs ~${count(bookings.expected)} typical`, weight: 0.1 });
    }

    const ups = this.competitorMoves(date, cat.id).filter((m) => m.changePct > 0);
    const avgUp = ups.length ? mean(ups.map((m) => m.changePct)) : 0;
    if (ups.length) {
      eventIds.push(...ups.map((m) => m.eventId));
      signals.push({
        label: 'Competitor rates',
        evidence: `${ups.length} competitor${ups.length > 1 ? 's' : ''} raised ${cat.name} rates (avg ${signedPct(avgUp, 0)}): ${ups.map((m) => this.compName(m.competitor)).join(', ')}`,
        weight: ups.length >= 2 ? 0.25 : 0.1,
      });
    }

    const fwd = this.forwardInventory(cat, date);
    if (fwd && fwd.remainingShare <= 0.4) {
      signals.push({
        label: 'Remaining inventory',
        evidence: `only ${pct(fwd.remainingShare * 100)} of ${cat.name} room-nights unsold over the next ${HORIZON_DAYS} days`,
        weight: fwd.remainingShare <= 0.25 ? 0.2 : 0.1,
      });
      for (const e of this.events.query({ types: ['INVENTORY_CHANGED'], fromTs: this.endTs(date) - 24 * HOUR, toTs: this.endTs(date), minSignificance: 'notable' }))
        if (e.payload.category === cat.id) eventIds.push(e.id);
    }

    const confidence = clamp(sum(signals.map((s) => s.weight)), 0, 1);
    if (signals.length < 2 || confidence < 0.5) return null;

    const rate = this.currentDirect(cat, date);
    const move = suggestPriceMove({ pickupMultiple: multiple, remainingShare: fwd?.remainingShare, competitorAvgUpPct: avgUp });
    const impact = fwd ? fwd.availableNights * rate * (move.centerPct / 100) : undefined;

    const parts = [
      `Demand for ${cat.name} rooms is well above this hotel's normal pattern: ${signals[0].evidence}.`,
      ...signals.slice(1).map((s) => `${s.label}: ${s.evidence}.`),
    ];
    return {
      id: this.id('demand_surge', date, cat.id),
      hotelId: this.profile.id,
      date,
      kind: 'demand_surge',
      domains: ['demand', 'pricing'],
      title: `Strong demand for ${cat.name} rooms`,
      summary: parts.join(' '),
      confidence,
      signals,
      category: cat.id,
      facts: {
        pickupObserved: pickup.observed,
        pickupExpected: round(pickup.expected, 1),
        pickupMultiple: round(multiple, 2),
        remainingPct: fwd ? round(fwd.remainingShare * 100, 0) : -1,
        availableRoomNights: fwd?.availableNights ?? -1,
        competitorsUp: ups.length,
        competitorAvgUpPct: round(avgUp, 1),
        currentRate: rate,
        suggestedLowPct: move.lowPct,
        suggestedHighPct: move.highPct,
      },
      impactAmount: impact,
      impactBasis: impact ? `${fwd!.availableNights} unsold ${cat.name} room-nights × ${money(rate)} × ${round(move.centerPct, 0)}% uplift` : undefined,
      severity: clamp(Math.min(1, (Math.abs(pickup.z) - 2) / 5) * 0.6 + confidence * 0.4, 0, 1),
      polarity: 'opportunity',
      urgency: 'today',
      eventIds,
      anomalyIds,
    };
  }

  private demandSoftness(date: DateKey, cat: RoomCategory, live: Anomaly[]): Situation | null {
    const pickup = live.find((a) => a.metric === `pickup:${cat.id}` && a.direction === 'down');
    if (!pickup) return null;
    const signals: Signal[] = [
      {
        label: 'Booking pace',
        evidence: `${count(pickup.observed)} ${cat.name} bookings vs ~${count(pickup.expected)} typical for a ${dowName(date)}`,
        weight: pickup.classification === 'actionable' ? 0.3 : 0.2,
      },
    ];
    const anomalyIds = [pickup.id];
    const eventIds: string[] = [];
    const occ = live.find((a) => a.metric === 'occupancy_pct' && a.direction === 'down');
    if (occ) {
      anomalyIds.push(occ.id);
      signals.push({ label: 'Occupancy', evidence: `${pct(occ.observed)} vs ${pct(occ.expected)} expected`, weight: 0.15 });
    }
    const downs = this.competitorMoves(date, cat.id).filter((m) => m.changePct < 0);
    if (downs.length) {
      eventIds.push(...downs.map((m) => m.eventId));
      signals.push({
        label: 'Competitor rates',
        evidence: `${downs.length} competitor${downs.length > 1 ? 's' : ''} cut ${cat.name} rates (${downs.map((m) => `${this.compName(m.competitor)} ${signedPct(m.changePct)}`).join(', ')})`,
        weight: downs.length >= 2 ? 0.25 : 0.1,
      });
    }
    const fwd = this.forwardInventory(cat, date);
    if (fwd && fwd.remainingShare >= 0.6) {
      signals.push({ label: 'Remaining inventory', evidence: `${pct(fwd.remainingShare * 100)} of ${cat.name} room-nights still unsold over the next ${HORIZON_DAYS} days`, weight: 0.2 });
    }
    const confidence = clamp(sum(signals.map((s) => s.weight)), 0, 1);
    if (signals.length < 2 || confidence < 0.45) return null;
    const missing = Math.max(0, pickup.expected - pickup.observed);
    const impact = missing * cat.baseRate * 1.5;
    return {
      id: this.id('demand_softness', date, cat.id),
      hotelId: this.profile.id,
      date,
      kind: 'demand_softness',
      domains: ['demand', 'pricing'],
      title: `Soft demand for ${cat.name} rooms`,
      summary: `${cat.name} demand is below this hotel's normal pattern: ${signals.map((s) => s.evidence).join('; ')}.`,
      confidence,
      signals,
      category: cat.id,
      facts: {
        pickupObserved: pickup.observed,
        pickupExpected: round(pickup.expected, 1),
        remainingPct: fwd ? round(fwd.remainingShare * 100, 0) : -1,
        currentRate: this.currentDirect(cat, date),
      },
      impactAmount: impact,
      impactBasis: `${round(missing, 0)} missing bookings × ${money(cat.baseRate)} × ~1.5 nights`,
      severity: clamp(Math.min(1, (Math.abs(pickup.z) - 2) / 5) * 0.6 + confidence * 0.4, 0, 1),
      polarity: 'problem',
      urgency: 'today',
      eventIds,
      anomalyIds,
    };
  }

  /* -------------------------------------------------------------- *
   * market & pricing position
   * -------------------------------------------------------------- */

  private marketMove(date: DateKey): Situation | null {
    const moves = this.competitorMoves(date);
    const total = this.profile.competitors.length;
    const needed = Math.max(2, Math.ceil(total / 2));
    for (const dir of ['up', 'down'] as const) {
      const sel = moves.filter((m) => (dir === 'up' ? m.changePct > 0 : m.changePct < 0));
      const competitors = [...new Set(sel.map((m) => m.competitor))];
      if (competitors.length < needed) continue;
      const avg = mean(sel.map((m) => m.changePct));
      const names = competitors.map((c) => this.compName(c));
      return {
        id: this.id('market_move', date, dir),
        hotelId: this.profile.id,
        date,
        kind: 'market_move',
        domains: ['market', 'pricing'],
        title: `${competitors.length} competitors ${dir === 'up' ? 'raised' : 'cut'} prices`,
        summary: `${names.join(', ')} ${dir === 'up' ? 'increased' : 'reduced'} rates by an average of ${signedPct(avg, 0)} across ${[...new Set(sel.map((m) => m.category))].length} room categories in the last 48 hours.`,
        confidence: clamp(0.5 + 0.15 * competitors.length, 0, 1),
        signals: sel.map((m) => ({
          label: this.compName(m.competitor),
          evidence: `${m.category}: ${signedPct(m.changePct, 1)}`,
          weight: 1 / sel.length,
        })),
        facts: { competitors: competitors.length, avgChangePct: round(avg, 1), direction: dir },
        severity: clamp(Math.abs(avg) / 20 + 0.1 * competitors.length, 0, 1),
        polarity: 'neutral',
        // Context for pricing decisions, not a problem to act on by itself: capped below critical.
        urgency: 'this_week',
        eventIds: sel.map((m) => m.eventId),
        anomalyIds: [],
      };
    }
    return null;
  }

  private priceUndercut(date: DateKey, cat: RoomCategory): Situation | null {
    const end = this.endTs(date);
    const own = this.state.ownRateAt('own_direct', cat.id, end);
    const comps = this.state.competitorRatesAt(cat.id, end);
    if (own === undefined || comps.length < 2) return null;
    const lowest = comps.reduce((a, b) => (b.price < a.price ? b : a));
    const gap = ((own - lowest.price) / lowest.price) * 100;
    if (gap < 8) return null;
    const ota = this.state.ownRateAt('own_ota', cat.id, end);
    return {
      id: this.id('price_undercut', date, cat.id),
      hotelId: this.profile.id,
      date,
      kind: 'price_undercut',
      domains: ['pricing', 'market'],
      title: `${cat.name} direct rate is ${round(gap, 0)}% above the lowest comparable`,
      summary: `Your direct ${cat.name} price (${money(own)}) is about ${round(gap, 0)}% above the lowest comparable market price (${this.compName(lowest.competitor)} at ${money(lowest.price)}). Market: ${comps.map((c) => `${this.compName(c.competitor)} ${money(c.price)}`).join(', ')}.${ota !== undefined ? ` Your OTA price is ${money(ota)}.` : ''}`,
      confidence: clamp(0.4 + comps.length * 0.1, 0, 0.8),
      signals: [{ label: 'Price gap', evidence: `${money(own)} vs ${money(lowest.price)}`, weight: 1 }],
      category: cat.id,
      facts: { ownDirect: own, lowestMarket: lowest.price, gapPct: round(gap, 1), lowestCompetitor: lowest.competitor },
      severity: clamp(gap / 30, 0, 1),
      polarity: 'problem',
      urgency: 'this_week',
      eventIds: [],
      anomalyIds: [],
    };
  }

  private rateParity(date: DateKey, cat: RoomCategory): Situation | null {
    const end = this.endTs(date);
    const direct = this.state.ownRateAt('own_direct', cat.id, end);
    const ota = this.state.ownRateAt('own_ota', cat.id, end);
    if (direct === undefined || ota === undefined) return null;
    const gap = ((direct - ota) / ota) * 100;
    if (gap < 3) return null;
    return {
      id: this.id('rate_parity_gap', date, cat.id),
      hotelId: this.profile.id,
      date,
      kind: 'rate_parity_gap',
      domains: ['pricing'],
      title: `${cat.name}: direct rate is ${round(gap, 0)}% above the OTA rate`,
      summary: `Guests can book ${cat.name} rooms cheaper on an OTA (${money(ota)}) than on the hotel's own channel (${money(direct)}), a ${round(gap, 1)}% gap. This pushes bookings to commissioned channels.`,
      confidence: 0.9,
      signals: [{ label: 'Direct vs OTA', evidence: `${money(direct)} vs ${money(ota)}`, weight: 1 }],
      category: cat.id,
      facts: { direct, ota, gapPct: round(gap, 1) },
      severity: clamp(gap / 15, 0, 1),
      polarity: 'problem',
      urgency: 'this_week',
      eventIds: [],
      anomalyIds: [],
    };
  }

  /* -------------------------------------------------------------- *
   * single-metric anomalies enriched with context
   * -------------------------------------------------------------- */

  private fromAnomaly(date: DateKey, a: Anomaly, live: Anomaly[]): Situation | null {
    switch (a.metric) {
      case 'revenue':
        return this.revenueDeviation(date, a, live);
      case 'cancellations':
        return this.cancellationSpike(date, a, live);
      case 'electricity_kwh':
        return this.energy(date, a);
      case 'water_kl':
      case 'maintenance_cost':
      case 'staff_cost':
      case 'expenses':
      case 'fnb_wastage':
        return this.costAnomaly(date, a);
      default:
        return null; // occupancy, bookings, pickup, adr feed other situations as signals
    }
  }

  private revenueDeviation(date: DateKey, a: Anomaly, live: Anomaly[]): Situation {
    const roomsObs = this.metrics.get('rooms_sold', date);
    const roomsExp = this.baseline.expect('rooms_sold', date)?.expected;
    const adrObs = this.metrics.get('adr', date);
    const adrExp = this.baseline.expect('adr', date)?.expected;
    const total = a.observed - a.expected;
    const facts: Situation['facts'] = { observed: Math.round(a.observed), expected: Math.round(a.expected), deviationPct: round(a.deviationPct, 1) };
    const signals: Signal[] = [];
    let driver = '';

    if (roomsObs !== undefined && roomsExp !== undefined && adrObs !== undefined && adrExp !== undefined) {
      const volume = (roomsObs - roomsExp) * adrExp;
      const price = (adrObs - adrExp) * roomsObs;
      facts.volumeEffect = Math.round(volume);
      facts.priceEffect = Math.round(price);
      const volShare = Math.abs(volume) / (Math.abs(volume) + Math.abs(price) || 1);
      driver =
        volShare >= 0.6
          ? `mostly volume: ${count(roomsObs)} rooms sold vs ~${count(roomsExp)} expected (${money(volume)} effect), with ADR ${money(adrObs)} vs ~${money(adrExp)}`
          : volShare <= 0.4
            ? `mostly rate: ADR ${money(adrObs)} vs ~${money(adrExp)} expected (${money(price)} effect), on ${count(roomsObs)} rooms sold vs ~${count(roomsExp)}`
            : `both volume (${count(roomsObs)} vs ~${count(roomsExp)} rooms) and rate (ADR ${money(adrObs)} vs ~${money(adrExp)})`;
      signals.push({ label: 'Driver', evidence: driver, weight: 0.5 });
    }
    const anomalyIds = [a.id];
    const cx = live.find((x) => x.metric === 'cancellations' && x.direction === 'up');
    if (cx) {
      anomalyIds.push(cx.id);
      signals.push({ label: 'Cancellations', evidence: `${count(cx.observed)} cancellations vs ~${count(cx.expected)} expected`, weight: 0.3 });
    }
    const below = a.direction === 'down';
    return {
      id: this.id('revenue_deviation', date),
      hotelId: this.profile.id,
      date,
      kind: 'revenue_deviation',
      domains: ['revenue', 'finance'],
      title: `Revenue ${below ? 'below' : 'above'} expected by ${round(Math.abs(a.deviationPct), 0)}%`,
      summary: `Revenue was ${money(a.observed)} vs ${money(a.expected)} expected for a ${dowName(date)} (${signedPct(a.deviationPct, 0)}).${driver ? ` The gap is ${driver}.` : ''}${cx ? ` Cancellations also ran high (${count(cx.observed)} vs ~${count(cx.expected)} expected).` : ''}`,
      confidence: clamp(a.confidence, 0, 1),
      signals,
      metric: 'revenue',
      facts,
      impactAmount: Math.abs(total),
      impactBasis: `revenue ${below ? 'shortfall' : 'beat'} vs the weekday baseline`,
      severity: clamp((Math.abs(a.z) - 2) / 5, 0, 1),
      polarity: below ? 'problem' : 'opportunity',
      urgency: below ? 'today' : 'fyi',
      eventIds: [],
      anomalyIds,
    };
  }

  private cancellationSpike(date: DateKey, a: Anomaly, live: Anomaly[]): Situation {
    const cancels = this.events.query({ fromDate: date, toDate: date, types: ['ROOM_CANCELLED'] });
    const bookings = this.metrics.get('bookings', date) ?? 0;
    const rate = bookings ? (a.observed / bookings) * 100 : 0;
    // one definition of "typical rate" across the brief: the rate series' own baseline
    const typicalRate = this.baseline.expect('cancellation_rate', date)?.expected ?? (bookings ? (a.expected / bookings) * 100 : 0);
    const breakdown = (key: string): string => {
      const counts = new Map<string, number>();
      for (const e of cancels) counts.set(String(e.payload[key]), (counts.get(String(e.payload[key])) ?? 0) + 1);
      const top = [...counts.entries()].sort((x, y) => y[1] - x[1])[0];
      const name = key === 'category' ? (this.profile.categories.find((c) => c.id === top?.[0])?.name ?? top?.[0]) : top?.[0];
      return top ? `${name} (${top[1]} of ${cancels.length})` : 'n/a';
    };
    const avg = cancels.length ? mean(cancels.map((e) => Number(e.payload.amount))) : 0;
    const excess = Math.max(0, a.observed - a.expected);
    const nearTerm = cancels.filter((e) => Number(e.payload.leadDays) <= 3).length;
    return {
      id: this.id('cancellation_spike', date),
      hotelId: this.profile.id,
      date,
      kind: 'cancellation_spike',
      domains: ['cancellations', 'revenue'],
      title: `Cancellation rate ${pct(rate, 0)} vs ${pct(typicalRate, 0)} normal`,
      summary: `Cancellations rose to ${pct(rate, 1)} of new bookings (${count(a.observed)} cancellations vs ~${count(a.expected)} expected for ${count(bookings)} bookings), up from a typical ${pct(typicalRate, 1)}. Largest source: channel ${breakdown('channel')}; category ${breakdown('category')}; ${nearTerm} were for stays within 3 days.`,
      confidence: clamp(a.confidence, 0, 1),
      signals: [
        { label: 'Volume', evidence: `${count(a.observed)} vs ~${count(a.expected)} expected given ${count(bookings)} bookings (z=${round(a.z, 1)})`, weight: 0.6 },
        { label: 'Concentration', evidence: `channel ${breakdown('channel')}`, weight: 0.4 },
      ],
      metric: 'cancellations',
      facts: { cancellations: a.observed, expectedCancellations: round(a.expected, 1), ratePct: round(rate, 1), typicalRatePct: round(typicalRate, 1), topChannel: breakdown('channel'), topCategory: breakdown('category'), nearTermCancellations: nearTerm },
      impactAmount: excess * avg,
      impactBasis: `${round(excess, 0)} excess cancellations × ${money(avg)} average booking value`,
      severity: clamp((Math.abs(a.z) - 2) / 5, 0, 1),
      polarity: 'problem',
      urgency: 'today',
      eventIds: cancels.slice(0, 20).map((e) => e.id),
      anomalyIds: [a.id],
    };
  }

  private energy(date: DateKey, a: Anomaly): Situation {
    const occ = this.metrics.get('occupancy_pct', date);
    const occExp = this.baseline.expect('occupancy_pct', date)?.expected;
    const typical = this.baseline.expect('electricity_kwh', date, { seasonalOnly: true })?.expected;
    const excess = a.observed - a.expected;
    const cost = excess * this.profile.energyTariffPerKwh;
    const vsTypical = typical ? ((a.observed - typical) / typical) * 100 : undefined;
    const occDelta = occ !== undefined && occExp ? ((occ - occExp) / occExp) * 100 : undefined;
    const accounted = a.method === 'regression';
    const summary =
      `Electricity consumption was ${count(a.observed)} kWh, ${round(a.deviationPct, 0)}% above the ${count(a.expected)} kWh this hotel normally uses ${accounted ? 'at this level of occupancy' : `on a ${dowName(date)}`}` +
      (vsTypical !== undefined && occDelta !== undefined ? ` (${signedPct(vsTypical, 0)} vs a typical ${dowName(date)}, while occupancy was ${signedPct(occDelta, 0)} vs its typical ${pct(occExp!, 0)})` : '') +
      `. That deviation is unusual compared with the historical relationship between occupancy and electricity. Estimated excess cost ≈ ${money(cost)}.`;
    return {
      id: this.id('energy_inefficiency', date),
      hotelId: this.profile.id,
      date,
      kind: 'energy_inefficiency',
      domains: ['operations'],
      title: `Electricity ${round(a.deviationPct, 0)}% above expected for occupancy`,
      summary,
      confidence: clamp(a.confidence, 0, 1),
      signals: [
        { label: 'Consumption', evidence: `${count(a.observed)} vs ${count(a.expected)} kWh expected (z=${round(a.z, 1)})`, weight: 0.7 },
        ...(occDelta !== undefined ? [{ label: 'Occupancy', evidence: `${pct(occ!, 0)} vs ${pct(occExp!, 0)} typical`, weight: 0.3 }] : []),
      ],
      metric: 'electricity_kwh',
      facts: { observedKwh: Math.round(a.observed), expectedKwh: Math.round(a.expected), deviationPct: round(a.deviationPct, 1), excessKwh: Math.round(excess), excessCost: Math.round(cost) },
      impactAmount: cost,
      impactBasis: `${count(excess)} excess kWh × ${money(this.profile.energyTariffPerKwh)}/kWh`,
      severity: clamp((Math.abs(a.z) - 2) / 5, 0, 1),
      polarity: 'problem',
      urgency: 'today',
      eventIds: [],
      anomalyIds: [a.id],
    };
  }

  private costAnomaly(date: DateKey, a: Anomaly): Situation {
    const accounted = a.method === 'regression';
    const money$ = a.unit === '₹';
    const excess = a.observed - a.expected;
    return {
      id: this.id('cost_anomaly', date, a.metric),
      hotelId: this.profile.id,
      date,
      kind: 'cost_anomaly',
      domains: a.domains,
      title: `${a.label} ${a.direction === 'up' ? 'above' : 'below'} expected by ${round(Math.abs(a.deviationPct), 0)}%`,
      summary: `${a.label} was ${formatMetric(a.unit, a.observed)} vs ${formatMetric(a.unit, a.expected)} expected${accounted ? ' after accounting for occupancy' : ` for a ${dowName(date)}`} (${signedPct(a.deviationPct, 0)}, z=${round(a.z, 1)}).`,
      confidence: clamp(a.confidence, 0, 1),
      signals: [{ label: a.label, evidence: `${formatMetric(a.unit, a.observed)} vs ${formatMetric(a.unit, a.expected)}`, weight: 1 }],
      metric: a.metric,
      facts: { observed: round(a.observed, 1), expected: round(a.expected, 1), deviationPct: round(a.deviationPct, 1) },
      impactAmount: money$ && excess > 0 ? excess : undefined,
      impactBasis: money$ ? `${a.label} above baseline` : undefined,
      severity: clamp((Math.abs(a.z) - 2) / 5, 0, 1),
      polarity: a.favorable === false ? 'problem' : 'neutral',
      // Cost lumps are common; only an extreme one demands action today.
      urgency: Math.abs(a.z) >= 5 ? 'today' : 'this_week',
      eventIds: [],
      anomalyIds: [a.id],
    };
  }
}

