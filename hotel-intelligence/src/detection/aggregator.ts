import { PICKUP_PREFIX } from '../baseline/metricSpecs';
import type { DateKey, HotelProfile } from '../types';
import { totalRooms } from '../types';
import type { EventStore } from '../store/eventStore';
import type { MetricStore } from '../store/metricStore';
import { round } from '../util/stats';

/**
 * Derives the daily series the baselines learn from: booking counts, per-category pickup,
 * cancellation rate, rooms sold and ADR.
 *
 * Data-quality rule: if a date has no reservation events at all we assume the feed was down and
 * derive nothing, rather than recording "0 bookings" and raising a phantom anomaly.
 */
export const deriveDailyMetrics = (date: DateKey, profile: HotelProfile, events: EventStore, metrics: MetricStore): void => {
  const dayEvents = events.query({ fromDate: date, toDate: date, types: ['ROOM_BOOKED', 'ROOM_CANCELLED'] });
  if (dayEvents.length) {
    const booked = dayEvents.filter((e) => e.type === 'ROOM_BOOKED');
    const cancelled = dayEvents.filter((e) => e.type === 'ROOM_CANCELLED');
    metrics.set('bookings', date, booked.length);
    metrics.set('cancellations', date, cancelled.length);
    if (booked.length >= 5) metrics.set('cancellation_rate', date, round((cancelled.length / booked.length) * 100, 1));
    for (const c of profile.categories) {
      metrics.set(`${PICKUP_PREFIX}${c.id}`, date, booked.filter((e) => e.payload.category === c.id).length);
    }
  }

  const occ = metrics.get('occupancy_pct', date);
  if (occ !== undefined && metrics.get('rooms_sold', date) === undefined) {
    metrics.set('rooms_sold', date, round((occ / 100) * totalRooms(profile), 1));
  }
  const sold = metrics.get('rooms_sold', date);
  const revenue = metrics.get('revenue', date);
  if (sold && revenue !== undefined) metrics.set('adr', date, round(revenue / sold, 0));
};
