import { describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../src/integration/adapter';
import { dailyReportCsvAdapter, reservationsCsvAdapter } from '../src/integration/csvAdapters';
import { meterAdapter, pmsWebhookAdapter, signWebhook, verifyWebhookSignature } from '../src/integration/jsonAdapters';
import { HotelIntelligence } from '../src/platform';
import { HOTEL_MERIDIAN } from '../src/demo/simulator';

const ctx = { profile: HOTEL_MERIDIAN };

describe('adapters', () => {
  it('maps a hotel-specific CSV export without reformatting it', () => {
    const csv = 'Res No,Booked At,State,Room Type,Total (₹),Nights,Source,Arrival\nR1,2026-10-01 10:15,Booked,deluxe,"13,000",2,booking.com,2026-10-05';
    const a = reservationsCsvAdapter('csv.legacy', {
      bookingId: 'Res No', timestamp: 'Booked At', status: 'State', category: 'Room Type', amount: 'Total (₹)', nights: 'Nights', channel: 'Source', stayDate: 'Arrival', roomId: undefined,
    });
    const [obs] = a.parse(csv, ctx);
    expect(obs).toMatchObject({ kind: 'booking', bookingId: 'R1', status: 'confirmed', category: 'deluxe', amount: 13000, nights: 2, channel: 'booking.com', stayDate: '2026-10-05' });
  });

  it('fails loudly, with context, on rows it cannot understand', () => {
    const a = reservationsCsvAdapter();
    expect(() => a.parse('booking_id,timestamp,status,category,amount,nights,channel,stay_date\nR1,2026-10-01 10:00,weird,deluxe,100,1,x,2026-10-02', ctx)).toThrow(/unknown status "weird"/);
    expect(() => a.parse('booking_id,timestamp,status,category,amount,nights,channel,stay_date\nR1,2026-10-01 10:00,booked,deluxe,abc,1,x,2026-10-02', ctx)).toThrow(/not a number/);
  });

  it('skips empty cells in wide daily reports instead of inventing zeros', () => {
    const a = dailyReportCsvAdapter('r', 'date', { occ: 'occupancy_pct', kwh: 'electricity_kwh' });
    const obs = a.parse('date,occ,kwh\n2026-10-01,71,\n', ctx);
    expect(obs).toHaveLength(1);
    expect(obs[0]).toMatchObject({ metric: 'occupancy_pct', value: 71 });
  });

  it('a new vendor needs only a registration, and ids cannot collide', () => {
    const r = new AdapterRegistry().register(pmsWebhookAdapter('pms.a')).register(pmsWebhookAdapter('pms.b'));
    expect(r.list().map((x) => x.id)).toEqual(['pms.a', 'pms.b']);
    expect(() => r.register(pmsWebhookAdapter('pms.a'))).toThrow(/already registered/);
    expect(() => r.get('nope')).toThrow(/Unknown adapter/);
  });
});

describe('webhook authentication', () => {
  const body = JSON.stringify({ event: 'reservation.created', occurredAt: '2026-10-04T10:00:00Z', data: {} });
  it('accepts a correct signature and rejects tampered or malformed ones', () => {
    const sig = signWebhook(body, 's3cret');
    expect(verifyWebhookSignature(body, sig, 's3cret')).toBe(true);
    expect(verifyWebhookSignature(body + ' ', sig, 's3cret')).toBe(false);
    expect(verifyWebhookSignature(body, sig, 'other')).toBe(false);
    expect(verifyWebhookSignature(body, 'zz', 's3cret')).toBe(false);
    expect(verifyWebhookSignature(body, '', 's3cret')).toBe(false);
  });
});

describe('ingestion is idempotent', () => {
  const make = () => {
    const h = new HotelIntelligence(HOTEL_MERIDIAN);
    h.registry.register(pmsWebhookAdapter()).register(meterAdapter());
    return h;
  };
  const payload = {
    event: 'reservation.created' as const,
    occurredAt: '2026-10-04T10:00:00+05:30',
    data: { bookingId: 'B1', roomType: 'deluxe', total: 13000, nights: 2, channel: 'direct', arrival: '2026-10-06' },
  };

  it('a retried webhook is one booking, not two', () => {
    const h = make();
    expect(h.ingest('pms.webhook', payload).eventsAppended).toBe(1);
    const again = h.ingest('pms.webhook', payload);
    expect(again.eventsAppended).toBe(0);
    expect(again.duplicates).toBe(1);
    expect(h.events.query({ types: ['ROOM_BOOKED'] })).toHaveLength(1);
    expect(h.metrics.get('bookings', '2026-10-04')).toBe(1);
  });

  it('a replayed meter reading is not added to the daily total twice', () => {
    const h = make();
    const r = { meterId: 'm', type: 'electricity' as const, intervalValue: 500, readAt: '2026-10-04T06:00:00+05:30' };
    h.ingest('iot.meters', r);
    h.ingest('iot.meters', r);
    h.ingest('iot.meters', { ...r, readAt: '2026-10-04T12:00:00+05:30' });
    expect(h.metrics.get('electricity_kwh', '2026-10-04')).toBe(1000);
  });
});
