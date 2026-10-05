import type { HotelEvent, HotelProfile, Significance } from '../types';

/**
 * Decides whether a single raw event is worth looking at. This is deliberately conservative:
 * most events are noise on their own and only matter in aggregate (e.g. one booking is noise,
 * but a day with 87 bookings is an anomaly — that is the baseline/anomaly engines' job).
 */
export const classifyEvent = (e: HotelEvent, profile: HotelProfile): { significance: Significance; reasons: string[] } => {
  const p = e.payload;
  const num = (k: string): number => Number(p[k] ?? 0);

  switch (e.type) {
    case 'ROOM_BOOKED':
    case 'ROOM_CANCELLED': {
      const amount = num('amount');
      if (amount >= profile.largeBookingAmount)
        return { significance: 'notable', reasons: [`large ${e.type === 'ROOM_BOOKED' ? 'booking' : 'cancellation'}: ${amount}`] };
      return { significance: 'noise', reasons: ['individual reservations matter only in aggregate'] };
    }

    case 'PRICE_CHANGED': {
      const pct = Math.abs(num('changePct'));
      if (pct >= 15) return { significance: 'major', reasons: [`own rate moved ${pct}%`] };
      if (pct >= 5) return { significance: 'notable', reasons: [`own rate moved ${pct}%`] };
      if (pct >= 2) return { significance: 'minor', reasons: [`own rate moved ${pct}%`] };
      return { significance: 'noise', reasons: ['rate wobble under 2%'] };
    }

    case 'COMPETITOR_PRICE_CHANGED': {
      const pct = Math.abs(num('changePct'));
      if (pct >= 20) return { significance: 'major', reasons: [`competitor moved ${pct}%`] };
      if (pct >= 6) return { significance: 'notable', reasons: [`competitor moved ${pct}%`] };
      if (pct >= 3) return { significance: 'minor', reasons: [`competitor moved ${pct}%`] };
      return { significance: 'noise', reasons: ['competitor wobble under 3%'] };
    }

    case 'INVENTORY_CHANGED': {
      const now = num('remainingPct');
      const before = num('previousRemainingPct');
      if (num('to') === 0) return { significance: 'major', reasons: ['category sold out for the date'] };
      if (before > 20 && now <= 20) return { significance: 'notable', reasons: [`remaining inventory fell to ${now}%`] };
      if (before > 40 && now <= 40) return { significance: 'minor', reasons: [`remaining inventory fell to ${now}%`] };
      return { significance: 'noise', reasons: ['routine availability movement'] };
    }

    case 'OCCUPANCY_CHANGED': {
      const d = Math.abs(num('deltaPts'));
      if (d >= 15) return { significance: 'major', reasons: [`occupancy moved ${d} pts`] };
      if (d >= 8) return { significance: 'notable', reasons: [`occupancy moved ${d} pts`] };
      if (d >= 3) return { significance: 'minor', reasons: [`occupancy moved ${d} pts`] };
      return { significance: 'noise', reasons: ['occupancy within a few points'] };
    }

    case 'PROMOTION_STARTED':
    case 'PROMOTION_ENDED':
      return { significance: 'notable', reasons: ['promotions change demand and baselines'] };

    default:
      // Anomaly-derived events carry their own significance, set at creation.
      return { significance: e.significance, reasons: e.reasons };
  }
};
