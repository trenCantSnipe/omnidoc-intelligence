import { createHmac, timingSafeEqual } from 'node:crypto';
import { parseTimestamp, toDateKey } from '../util/time';
import type { Observation } from '../types';
import { AdapterParseError, num, type AdapterContext, type SourceAdapter } from './adapter';

/** Builds an adapter from a plain mapping function; the cheapest way to add a new vendor. */
export const jsonAdapter = <Raw>(
  id: string,
  description: string,
  map: (raw: Raw, ctx: AdapterContext) => Observation[],
): SourceAdapter<Raw> => ({ id, description, parse: map });

/* ------------------------------------------------------------------ *
 * Example vendor payloads. A real PMS would get its own mapping like these.
 * ------------------------------------------------------------------ */

export interface PmsWebhookPayload {
  event: 'reservation.created' | 'reservation.cancelled' | 'inventory.updated' | 'rate.updated';
  occurredAt: string;
  data: Record<string, unknown>;
}

const str = (id: string, field: string, v: unknown): string => {
  if (typeof v !== 'string' || !v) throw new AdapterParseError(id, `field "${field}" missing`);
  return v;
};

export const pmsWebhookAdapter = (id = 'pms.webhook'): SourceAdapter<PmsWebhookPayload> =>
  jsonAdapter<PmsWebhookPayload>(id, 'PMS webhook: reservations, availability and rate updates', (p, { profile }) => {
    const ts = parseTimestamp(str(id, 'occurredAt', p.occurredAt), profile.tzOffsetMinutes);
    const d = p.data;
    switch (p.event) {
      case 'reservation.created':
      case 'reservation.cancelled':
        return [
          {
            kind: 'booking',
            source: id,
            ts,
            bookingId: str(id, 'bookingId', d.bookingId),
            status: p.event === 'reservation.created' ? 'confirmed' : 'cancelled',
            category: str(id, 'roomType', d.roomType),
            roomId: typeof d.roomNo === 'string' ? d.roomNo : undefined,
            amount: num(id, 'total', d.total),
            nights: num(id, 'nights', d.nights),
            channel: str(id, 'channel', d.channel),
            stayDate: str(id, 'arrival', d.arrival).slice(0, 10),
          },
        ];
      case 'inventory.updated':
        return [
          {
            kind: 'inventory',
            source: id,
            ts,
            category: str(id, 'roomType', d.roomType),
            stayDate: str(id, 'date', d.date).slice(0, 10),
            total: num(id, 'total', d.total),
            available: num(id, 'available', d.available),
          },
        ];
      case 'rate.updated':
        return [
          {
            kind: 'rate',
            source: id,
            ts,
            party: 'own_direct',
            category: str(id, 'roomType', d.roomType),
            roomId: typeof d.roomNo === 'string' ? d.roomNo : undefined,
            price: num(id, 'rate', d.rate),
          },
        ];
      default:
        throw new AdapterParseError(id, `unsupported event "${String((p as { event: string }).event)}"`);
    }
  });

export interface MeterReading {
  meterId: string;
  type: 'electricity' | 'water';
  /** Consumption in the interval ending at `readAt` (kWh or kL). */
  intervalValue: number;
  readAt: string;
}

/** IoT/utility interval readings accumulate into the daily totals the baselines are built on. */
export const meterAdapter = (id = 'iot.meters'): SourceAdapter<MeterReading> =>
  jsonAdapter<MeterReading>(id, 'Utility meters: interval kWh / kL readings', (r, { profile }) => {
    const ts = parseTimestamp(str(id, 'readAt', r.readAt), profile.tzOffsetMinutes);
    const metric = r.type === 'electricity' ? 'electricity_kwh' : 'water_kl';
    return [
      { kind: 'metric', source: id, ts, metric, date: toDateKey(ts, profile.tzOffsetMinutes), value: num(id, 'intervalValue', r.intervalValue), mode: 'add' },
    ];
  });

export interface RateShopRow {
  checkedAt: string;
  competitor: string;
  category: string;
  price: number;
}

export const rateShopJsonAdapter = (id = 'feed.rate_shop'): SourceAdapter<RateShopRow[]> =>
  jsonAdapter<RateShopRow[]>(id, 'Competitor rate-shopping feed', (rows, { profile }) =>
    rows.map((r) => ({
      kind: 'rate' as const,
      source: id,
      ts: parseTimestamp(r.checkedAt, profile.tzOffsetMinutes),
      party: 'competitor' as const,
      provider: r.competitor,
      category: r.category,
      price: num(id, 'price', r.price),
    })),
  );

/* ------------------------------------------------------------------ *
 * Webhook authentication
 * ------------------------------------------------------------------ */

/** Verifies an HMAC-SHA256 signature (hex) over the raw request body. Constant-time compare. */
export const verifyWebhookSignature = (rawBody: string, signatureHex: string, secret: string): boolean => {
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  let given: Buffer;
  try {
    given = Buffer.from(signatureHex, 'hex');
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
};

export const signWebhook = (rawBody: string, secret: string): string =>
  createHmac('sha256', secret).update(rawBody).digest('hex');
