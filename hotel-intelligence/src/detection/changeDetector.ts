import type { HotelEvent, HotelProfile, Observation } from '../types';
import { pctChange, round } from '../util/stats';
import { toDateKey } from '../util/time';
import type { StateStore } from '../store/stateStore';
import { makeEvent } from './events';

const MIN_RATE_MOVE_PCT = 0.1; // below this is float/rounding noise, not a change

/**
 * Turns the stream of observations into structured change events ("what changed").
 * It is the only component that diffs raw state; everything downstream consumes events.
 * Classification of *how much it matters* is separate (see classifier.ts).
 */
export class ChangeDetector {
  private lastOccupancy: { date: string; value: number } | null = null;

  constructor(
    private profile: HotelProfile,
    private state: StateStore,
  ) {}

  process(obs: Observation): HotelEvent[] {
    const tz = this.profile.tzOffsetMinutes;
    const hotelId = this.profile.id;
    const date = toDateKey(obs.ts, tz);

    switch (obs.kind) {
      case 'booking': {
        return [
          makeEvent({
            hotelId,
            type: obs.status === 'confirmed' ? 'ROOM_BOOKED' : 'ROOM_CANCELLED',
            ts: obs.ts,
            date,
            source: obs.source,
            // bookingId+status identifies the fact: a webhook retry must not double count
            dedupeKey: `${obs.bookingId}|${obs.status}`,
            payload: {
              bookingId: obs.bookingId,
              category: obs.category,
              roomId: obs.roomId ?? null,
              amount: obs.amount,
              nights: obs.nights,
              channel: obs.channel,
              stayDate: obs.stayDate,
              leadDays: Math.max(0, Math.round((Date.parse(obs.stayDate) - Date.parse(date)) / 86_400_000)),
            },
          }),
        ];
      }

      case 'rate': {
        const prev = this.state.applyRate(
          { party: obs.party, provider: obs.provider, category: obs.category, roomId: obs.roomId },
          obs.price,
          obs.ts,
        );
        if (prev === undefined) return []; // first sighting establishes state, it is not a change
        const changePct = pctChange(prev, obs.price);
        if (Math.abs(changePct) < MIN_RATE_MOVE_PCT) return [];
        const category = this.profile.categories.find((c) => c.id === obs.category);
        return [
          makeEvent({
            hotelId,
            type: obs.party === 'competitor' ? 'COMPETITOR_PRICE_CHANGED' : 'PRICE_CHANGED',
            ts: obs.ts,
            date,
            source: obs.source,
            dedupeKey: `${obs.party}|${obs.provider ?? ''}|${obs.category}|${obs.roomId ?? ''}|${obs.ts}|${obs.price}`,
            payload: {
              party: obs.party,
              provider: obs.provider ?? null,
              category: obs.category,
              categoryName: category?.name ?? obs.category,
              roomId: obs.roomId ?? null,
              oldPrice: prev,
              newPrice: obs.price,
              changePct: round(changePct, 1),
            },
          }),
        ];
      }

      case 'inventory': {
        const prev = this.state.applyInventory(obs.category, obs.stayDate, { total: obs.total, available: obs.available }, obs.ts);
        if (!prev || prev.available === obs.available) return [];
        return [
          makeEvent({
            hotelId,
            type: 'INVENTORY_CHANGED',
            ts: obs.ts,
            date,
            source: obs.source,
            dedupeKey: `${obs.category}|${obs.stayDate}|${obs.ts}|${obs.available}`,
            payload: {
              category: obs.category,
              stayDate: obs.stayDate,
              from: prev.available,
              to: obs.available,
              total: obs.total,
              remainingPct: obs.total ? round((obs.available / obs.total) * 100, 1) : 0,
              previousRemainingPct: prev.total ? round((prev.available / prev.total) * 100, 1) : 0,
            },
          }),
        ];
      }

      case 'promotion': {
        const was = this.state.applyPromotion(obs.promoId, obs.active, obs.ts);
        if (was === obs.active) return [];
        return [
          makeEvent({
            hotelId,
            type: obs.active ? 'PROMOTION_STARTED' : 'PROMOTION_ENDED',
            ts: obs.ts,
            date,
            source: obs.source,
            dedupeKey: `${obs.promoId}|${obs.active}|${obs.ts}`,
            payload: { promoId: obs.promoId, name: obs.name, discountPct: obs.discountPct ?? null },
          }),
        ];
      }

      case 'metric': {
        if (obs.metric !== 'occupancy_pct') return [];
        const prev = this.lastOccupancy;
        this.lastOccupancy = { date: obs.date, value: obs.value };
        if (!prev || Math.abs(obs.value - prev.value) < 1) return [];
        return [
          makeEvent({
            hotelId,
            type: 'OCCUPANCY_CHANGED',
            ts: obs.ts,
            date: obs.date,
            source: obs.source,
            dedupeKey: `${obs.date}|${obs.value}`,
            payload: { from: prev.value, to: obs.value, deltaPts: round(obs.value - prev.value, 1), previousDate: prev.date },
          }),
        ];
      }
    }
  }
}
