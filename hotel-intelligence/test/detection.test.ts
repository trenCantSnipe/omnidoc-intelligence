import { describe, expect, it } from 'vitest';
import { AnomalyDetector } from '../src/anomaly/anomalyDetector';
import { BaselineEngine } from '../src/baseline/baselineEngine';
import { HOTEL_MERIDIAN } from '../src/demo/simulator';
import { HotelIntelligence } from '../src/platform';
import { MetricStore } from '../src/store/metricStore';
import type { Observation } from '../src/types';
import { addDays, dayOfWeek, parseTimestamp } from '../src/util/time';

const ts = (s: string) => parseTimestamp(s, 330);
const rate = (at: string, price: number, extra: Partial<Observation> = {}): Observation => ({
  kind: 'rate', source: 't', ts: ts(at), party: 'own_direct', category: 'deluxe', roomId: '405', price, ...extra,
} as Observation);

describe('change detection', () => {
  it('turns a price move into a structured event (the ₹6,500 → ₹7,200 example)', () => {
    const h = new HotelIntelligence(HOTEL_MERIDIAN);
    h.ingestObservations([rate('2026-10-04 08:00', 6500)]);
    expect(h.events.size).toBe(0); // first sighting only establishes state
    h.ingestObservations([rate('2026-10-04 12:00', 7200)]);
    const [e] = h.events.query({ types: ['PRICE_CHANGED'] });
    expect(e.payload).toMatchObject({ roomId: '405', category: 'deluxe', categoryName: 'Deluxe', oldPrice: 6500, newPrice: 7200, changePct: 10.8 });
    expect(e.significance).toBe('notable');
  });

  it('ignores float noise and judges small wobbles as noise, not as news', () => {
    const h = new HotelIntelligence(HOTEL_MERIDIAN);
    h.ingestObservations([rate('2026-10-04 08:00', 6500), rate('2026-10-04 09:00', 6500.001), rate('2026-10-04 10:00', 6540)]);
    const evs = h.events.query({ types: ['PRICE_CHANGED'] });
    expect(evs).toHaveLength(1);
    expect(evs[0].significance).toBe('noise'); // +0.6%
    expect(h.events.query({ minSignificance: 'minor' })).toHaveLength(0);
  });

  it('distinguishes competitor moves from own moves', () => {
    const h = new HotelIntelligence(HOTEL_MERIDIAN);
    const c = (at: string, price: number): Observation => ({ kind: 'rate', source: 't', ts: ts(at), party: 'competitor', provider: 'grand_palace', category: 'deluxe', price });
    h.ingestObservations([c('2026-10-03 06:00', 6000), c('2026-10-04 06:00', 6600)]);
    const [e] = h.events.query({ types: ['COMPETITOR_PRICE_CHANGED'] });
    expect(e.payload.changePct).toBe(10);
    expect(e.significance).toBe('notable');
  });

  it('flags inventory crossing into scarcity, and sell-outs as major', () => {
    const h = new HotelIntelligence(HOTEL_MERIDIAN);
    const inv = (at: string, available: number): Observation => ({ kind: 'inventory', source: 't', ts: ts(at), category: 'deluxe', stayDate: '2026-10-10', total: 30, available });
    h.ingestObservations([inv('2026-10-04 08:00', 12), inv('2026-10-04 12:00', 11), inv('2026-10-04 16:00', 5), inv('2026-10-04 20:00', 0)]);
    const sig = h.events.query({ types: ['INVENTORY_CHANGED'] }).map((e) => e.significance);
    expect(sig).toEqual(['noise', 'notable', 'major']);
  });

  it('detects promotions starting and ending exactly once', () => {
    const h = new HotelIntelligence(HOTEL_MERIDIAN);
    const p = (at: string, active: boolean): Observation => ({ kind: 'promotion', source: 't', ts: ts(at), promoId: 'x', name: 'Staycation', active });
    h.ingestObservations([p('2026-10-01 09:00', true), p('2026-10-02 09:00', true), p('2026-10-05 09:00', false)]);
    expect(h.events.query({ types: ['PROMOTION_STARTED', 'PROMOTION_ENDED'] }).map((e) => e.type)).toEqual(['PROMOTION_STARTED', 'PROMOTION_ENDED']);
  });

  it('treats individual bookings as noise unless they are unusually large', () => {
    const h = new HotelIntelligence(HOTEL_MERIDIAN);
    const b = (id: string, amount: number): Observation => ({ kind: 'booking', source: 't', ts: ts('2026-10-04 10:00'), bookingId: id, status: 'confirmed', category: 'suite', amount, nights: 2, channel: 'direct', stayDate: '2026-10-08' });
    h.ingestObservations([b('a', 20000), b('b', 250000)]);
    const evs = h.events.query({ types: ['ROOM_BOOKED'] });
    expect(evs.map((e) => e.significance).sort()).toEqual(['noise', 'notable']);
  });
});

/** A hotel whose Fridays see 35–50 bookings, built directly into a metric store. */
const seededStore = (days = 98) => {
  const m = new MetricStore();
  const end = '2026-10-03'; // a Saturday; the next day is the Sunday we judge
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  for (let i = days; i >= 1; i--) {
    const d = addDays(end, 1 - i);
    const dow = dayOfWeek(d);
    const mean = dow === 5 ? 42 : dow === 6 ? 38 : 24;
    m.set('bookings', d, Math.round(mean + (rnd() - 0.5) * (dow === 5 ? 14 : 8)));
    const rooms = 40 + (dow >= 5 ? 22 : 8) + Math.round((rnd() - 0.5) * 8);
    m.set('rooms_sold', d, rooms);
    m.set('electricity_kwh', d, Math.round((1500 + 38 * rooms) * (1 + (rnd() - 0.5) * 0.05)));
    m.set('revenue', d, rooms * 5600);
  }
  return m;
};

describe('baselines and anomaly detection', () => {
  const store = seededStore();
  const engine = new BaselineEngine(store, HOTEL_MERIDIAN);
  const detector = new AnomalyDetector(engine, HOTEL_MERIDIAN);
  const friday = '2026-10-09'; // a Friday after the history ends (store has no values for it)

  it('learns what a normal Friday looks like for this hotel', () => {
    expect(dayOfWeek(friday)).toBe(5);
    const e = engine.expect('bookings', friday)!;
    expect(e.expected).toBeGreaterThan(36);
    expect(e.expected).toBeLessThan(48);
  });

  it('87 bookings on a Friday is an actionable anomaly; 45 is not', () => {
    const big = detector.evaluate('bookings', friday, 87)!;
    expect(big.classification).toBe('actionable');
    expect(big.direction).toBe('up');
    expect(big.deviationPct).toBeGreaterThan(70);
    expect(detector.evaluate('bookings', friday, 45)!.classification).toBe('normal');
  });

  it('electricity is judged against occupancy, not just against the calendar', () => {
    const d = '2026-10-10'; // Saturday
    store.set('rooms_sold', d, 70);
    const e = engine.expect('electricity_kwh', d)!;
    expect(e.method).toBe('regression');
    expect(e.drivers[0].name).toBe('rooms_sold');
    // high consumption that a busy hotel legitimately uses → normal
    expect(detector.evaluate('electricity_kwh', d, Math.round(e.expected * 1.03))!.classification).toBe('normal');
    // +43% at the same occupancy → actionable
    const spike = detector.evaluate('electricity_kwh', d, Math.round(e.expected * 1.43))!;
    expect(spike.classification).toBe('actionable');
  });

  it('electricity falling is never an alert; only the harmful direction can be actionable', () => {
    const d = '2026-10-10';
    const e = engine.expect('electricity_kwh', d)!;
    const low = detector.evaluate('electricity_kwh', d, Math.round(e.expected * 0.5))!;
    expect(low.classification).not.toBe('actionable');
  });

  it('operational significance is a separate gate: statistically passing but tiny deviations are not actionable', () => {
    const m = new MetricStore();
    for (let i = 60; i >= 1; i--) m.set('revenue', addDays('2026-10-03', 1 - i), 300000 + (i % 2));
    const engine2 = new BaselineEngine(m, HOTEL_MERIDIAN);
    // make the statistical gate trivially easy to pass so only the effect-size gate is under test
    const loose = new AnomalyDetector(engine2, HOTEL_MERIDIAN, { zActionable: 0.5, zWatch: 0.4 });
    const small = loose.evaluate('revenue', '2026-10-04', 312000)!; // +4%
    expect(Math.abs(small.z)).toBeGreaterThan(0.5);
    expect(small.classification).not.toBe('actionable');
    expect(loose.evaluate('revenue', '2026-10-04', 345000)!.classification).toBe('actionable'); // +15%
  });

  it('refuses to pass judgement without enough history', () => {
    const m = new MetricStore();
    for (let i = 8; i >= 1; i--) m.set('bookings', addDays('2026-10-03', 1 - i), 30);
    const det = new AnomalyDetector(new BaselineEngine(m, HOTEL_MERIDIAN), HOTEL_MERIDIAN);
    expect(det.evaluate('bookings', '2026-10-04', 200)!.classification).toBe('insufficient_baseline');
  });

  it('past incidents in the history do not teach the baseline that they are normal', () => {
    const m = seededStore();
    for (const d of ['2026-09-05', '2026-09-12', '2026-08-29']) m.set('bookings', d, 120); // three past Saturdays gone wild
    const e = new BaselineEngine(m, HOTEL_MERIDIAN).expect('bookings', '2026-10-10')!; // a Saturday
    expect(e.expected).toBeLessThan(50);
  });
});

describe('data-quality safety', () => {
  it('a day with no reservation feed is not reported as "0 bookings"', async () => {
    const h = new HotelIntelligence(HOTEL_MERIDIAN);
    h.metrics.set('occupancy_pct', '2026-10-04', 70);
    const r = await h.closeDay('2026-10-04');
    expect(h.metrics.get('bookings', '2026-10-04')).toBeUndefined();
    expect(r.evaluations.find((e) => e.metric === 'bookings')).toBeUndefined();
  });
});
