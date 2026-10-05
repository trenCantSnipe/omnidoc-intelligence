import type { MeterReading, PmsWebhookPayload, RateShopRow } from '../integration/jsonAdapters';
import type { HotelProfile, PromotionObservation } from '../types';
import { totalRooms } from '../types';
import { addDays, dateRange, dayOfWeek, parseTimestamp, type DateKey } from '../util/time';
import { clamp } from '../util/stats';

/** Fictional 80-room hotel used by the demo and the tests. */
export const HOTEL_MERIDIAN: HotelProfile = {
  id: 'meridian',
  name: 'Hotel Meridian',
  currency: 'INR',
  tzOffsetMinutes: 330,
  categories: [
    { id: 'standard', name: 'Standard', totalRooms: 40, premium: false, baseRate: 4200, minRate: 3400, maxRate: 5500 },
    { id: 'deluxe', name: 'Deluxe', totalRooms: 30, premium: true, baseRate: 6500, minRate: 5200, maxRate: 8500 },
    { id: 'suite', name: 'Suite', totalRooms: 10, premium: true, baseRate: 11000, minRate: 9000, maxRate: 14500 },
  ],
  competitors: [
    { id: 'grand_palace', name: 'Grand Palace' },
    { id: 'lakeview_inn', name: 'Lakeview Inn' },
    { id: 'orchid_residency', name: 'Orchid Residency' },
  ],
  calendar: { '2026-08-15': 'Independence Day', '2026-09-14': 'Ganesh Chaturthi', '2026-10-02': 'Gandhi Jayanti' },
  energyTariffPerKwh: 9,
  largeBookingAmount: 100_000,
};

export interface SimOptions {
  /** The "yesterday" the morning brief is about. */
  asOf: DateKey;
  historyDays: number;
  seed: number;
  /** Inject the strong-demand / energy / cancellation scenario on `asOf`. */
  scenario: boolean;
}

export interface SimData {
  profile: HotelProfile;
  start: DateKey;
  asOf: DateKey;
  /** Bulk exports used to bootstrap history (as a real onboarding would). */
  history: {
    reservationsCsv: string;
    dailyReportCsv: string;
    rateShopCsv: string;
    inventoryCsv: string;
    promotions: PromotionObservation[];
  };
  /** Live feeds for `asOf`, delivered through webhooks and APIs. */
  live: {
    webhooks: PmsWebhookPayload[];
    meterReadings: MeterReading[];
    rateShop: RateShopRow[];
    dailyReportCsv: string;
  };
}

const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const OCC_BY_DOW = [0.72, 0.6, 0.58, 0.62, 0.68, 0.85, 0.92]; // Sun..Sat
const BOOKINGS_BY_DOW = [26, 20, 19, 22, 31, 42, 38];
const CAT_MIX: [string, number][] = [['standard', 0.5], ['deluxe', 0.35], ['suite', 0.15]];
const CHANNELS: [string, number][] = [['direct', 0.3], ['booking.com', 0.35], ['makemytrip', 0.25], ['walk-in', 0.1]];
const COMP_MULT: Record<string, number> = { grand_palace: 1.03, lakeview_inn: 0.97, orchid_residency: 1.0 };

interface Booking {
  id: string;
  category: string;
  amount: number;
  nights: number;
  channel: string;
  stayDate: DateKey;
  cancelled: boolean;
}

export const simulateHotel = (opts: SimOptions): SimData => {
  const profile = HOTEL_MERIDIAN;
  const rng = mulberry32(opts.seed);
  const normal = (): number => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
  const pick = <T,>(table: [T, number][]): T => {
    let r = rng();
    for (const [v, p] of table) if ((r -= p) <= 0) return v;
    return table[table.length - 1][0];
  };
  const rooms = totalRooms(profile);
  const start = addDays(opts.asOf, -(opts.historyDays - 1));
  const hhmm = (d: DateKey, h: number, m = 0) => `${d} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const rate = (cat: string): number => profile.categories.find((c) => c.id === cat)!.baseRate;

  const pool: Booking[] = [];
  let seq = 1000;
  const reservationRows: string[] = ['booking_id,timestamp,status,category,amount,nights,channel,stay_date,room_id'];
  const dailyRows: string[] = ['date,occupancy_pct,revenue,electricity_kwh,water_kl,maintenance_cost,staff_cost,expenses,fnb_wastage'];
  const liveDailyRows: string[] = ['date,occupancy_pct,revenue,maintenance_cost,staff_cost,expenses,fnb_wastage'];
  const webhooks: PmsWebhookPayload[] = [];
  const meterReadings: MeterReading[] = [];
  const iso = (d: DateKey, h: number, m: number) => new Date(parseTimestamp(hhmm(d, h, m), profile.tzOffsetMinutes)).toISOString();

  for (const d of dateRange(start, opts.asOf)) {
    const live = d === opts.asOf;
    const scen = live && opts.scenario;
    const dow = dayOfWeek(d);
    const special = !!profile.calendar[d];

    /* ---- daily operating numbers ---- */
    const occ = clamp(OCC_BY_DOW[dow] + (special ? 0.08 : 0) + normal() * 0.035 + (scen ? 0.12 : 0), 0.3, 0.98);
    const occPct = Math.round(occ * 1000) / 10;
    const sold = (occPct / 100) * rooms;
    const adr = 5400 * (0.92 + 0.2 * occ) * (1 + normal() * 0.02) * (scen ? 1.02 : 1);
    const revenue = Math.round(sold * adr);
    const electricity = Math.round((1500 + 38 * sold) * (1 + normal() * 0.025) * (scen ? 1.43 : 1));
    const water = Math.round((8 + 0.35 * sold) * (1 + normal() * 0.04) * 10) / 10;
    const maintenance = Math.round(Math.max(1500, 12000 * Math.exp(normal() * 0.35)));
    const staff = Math.round((38000 + 150 * sold) * (1 + normal() * 0.03));
    const expenses = Math.round(25000 * (1 + normal() * 0.08));
    const wastage = Math.round((6 + 0.1 * sold) * (1 + normal() * 0.1) * 10) / 10;

    if (live) liveDailyRows.push([d, occPct, revenue, maintenance, staff, expenses, wastage].join(','));
    else dailyRows.push([d, occPct, revenue, electricity, water, maintenance, staff, expenses, wastage].join(','));

    if (live) {
      const split = [0.2, 0.3, 0.3, 0.2];
      [6, 12, 18, 23].forEach((h, i) => {
        meterReadings.push({ meterId: 'main-incomer', type: 'electricity', intervalValue: Math.round(electricity * split[i] * 10) / 10, readAt: iso(d, h, h === 23 ? 59 : 0) });
        meterReadings.push({ meterId: 'water-main', type: 'water', intervalValue: Math.round(water * split[i] * 100) / 100, readAt: iso(d, h, h === 23 ? 59 : 0) });
      });
    }

    /* ---- reservations ---- */
    const bookingMean = BOOKINGS_BY_DOW[dow] * (special ? 1.2 : 1);
    let nBookings = Math.max(5, Math.round(bookingMean + normal() * Math.sqrt(bookingMean) * 0.9));
    let catPlan: string[] | null = null;
    if (scen) {
      nBookings = 46;
      catPlan = [...Array(17).fill('standard'), ...Array(22).fill('deluxe'), ...Array(7).fill('suite')];
    }
    const todays: Booking[] = [];
    for (let i = 0; i < nBookings; i++) {
      const category = catPlan ? catPlan[i] : pick(CAT_MIX);
      const nights = 1 + Math.min(3, Math.floor(-Math.log(1 - rng()) * 0.6));
      const lead = Math.min(45, Math.floor(-Math.log(1 - rng()) * 6));
      const b: Booking = {
        id: `B${seq++}`,
        category,
        nights,
        amount: Math.round((rate(category) * nights * (1 + normal() * 0.03)) / 10) * 10,
        channel: pick(CHANNELS),
        stayDate: addDays(d, lead),
        cancelled: false,
      };
      todays.push(b);
      const t = [8 + Math.floor(rng() * 15), Math.floor(rng() * 60)] as const;
      emit(d, t[0], t[1], 'confirmed', b);
    }
    pool.push(...todays);

    let nCancel = Math.max(0, Math.round(nBookings * 0.07 + normal() * Math.sqrt(nBookings * 0.07)));
    if (scen) nCancel = 9;
    const candidates = pool.filter((b) => !b.cancelled && b.stayDate >= d && !todays.includes(b));
    for (let i = 0; i < nCancel && candidates.length; i++) {
      let idx = Math.floor(rng() * candidates.length);
      if (scen) {
        // scenario: cancellations concentrate on one OTA
        const ota = candidates.findIndex((b) => b.channel === 'booking.com');
        if (i < 6 && ota >= 0) idx = ota;
      }
      const b = candidates.splice(idx, 1)[0];
      b.cancelled = true;
      emit(d, 9 + Math.floor(rng() * 14), Math.floor(rng() * 60), 'cancelled', b);
    }
  }

  function emit(d: DateKey, h: number, m: number, status: 'confirmed' | 'cancelled', b: Booking): void {
    if (d === opts.asOf) {
      webhooks.push({
        event: status === 'confirmed' ? 'reservation.created' : 'reservation.cancelled',
        occurredAt: iso(d, h, m),
        data: { bookingId: b.id, roomType: b.category, total: b.amount, nights: b.nights, channel: b.channel, arrival: b.stayDate },
      });
    } else {
      reservationRows.push([b.id, hhmm(d, h, m), status, b.category, b.amount, b.nights, b.channel, b.stayDate, ''].join(','));
    }
  }

  /* ---- rate shopping ---- */
  const rateRows: string[] = ['timestamp,party,provider,category,price'];
  const rateStart = addDays(opts.asOf, -30);
  const liveRates: RateShopRow[] = [];
  const own = (cat: string, d: DateKey): number => (cat === 'deluxe' && d < addDays(opts.asOf, -12) ? 6200 : rate(cat));
  for (const d of dateRange(rateStart, opts.asOf)) {
    const live = d === opts.asOf;
    const weekend = 1;
    for (const c of profile.categories) {
      if (!live) {
        rateRows.push(`${hhmm(d, 6)},own_direct,,${c.id},${own(c.id, d)}`);
        const ota = c.id === 'standard' ? Math.round((own(c.id, d) * 0.94) / 50) * 50 : own(c.id, d); // parity gap on Standard
        rateRows.push(`${hhmm(d, 6)},own_ota,booking.com,${c.id},${ota}`);
      } else {
        // The hotel's own rates are unchanged today, but the feed still reports them.
        rateRows.push(`${hhmm(d, 6)},own_direct,,${c.id},${own(c.id, d)}`);
        const ota = c.id === 'standard' ? Math.round((own(c.id, d) * 0.94) / 50) * 50 : own(c.id, d);
        rateRows.push(`${hhmm(d, 6)},own_ota,booking.com,${c.id},${ota}`);
      }
      for (const comp of profile.competitors) {
        let price = Math.round((c.baseRate * COMP_MULT[comp.id] * weekend * (1 + normal() * 0.008)) / 50) * 50;
        if (live && opts.scenario && c.id !== 'standard') {
          const move = comp.id === 'grand_palace' ? 1.09 : comp.id === 'orchid_residency' ? 1.08 : 1.06;
          price = Math.round((c.baseRate * COMP_MULT[comp.id] * weekend * move) / 50) * 50;
        }
        if (live) liveRates.push({ checkedAt: iso(d, 6, 0), competitor: comp.id, category: c.id, price });
        else rateRows.push(`${hhmm(d, 6)},competitor,${comp.id},${c.id},${price}`);
      }
    }
  }

  /* ---- inventory snapshots ---- */
  const invRows: string[] = ['timestamp,category,stay_date,total,available'];
  const invWebhooks: PmsWebhookPayload[] = [];
  const remaining = (cat: string, stay: DateKey, k: number, scenario: boolean): number => {
    const c = profile.categories.find((x) => x.id === cat)!;
    const fill = OCC_BY_DOW[dayOfWeek(stay)] * (0.5 + 0.5 * (1 - k / 7)) * (cat === 'suite' ? 0.85 : 1);
    let avail = Math.round(c.totalRooms * (1 - fill) + normal() * 1.2);
    if (scenario && cat === 'deluxe') avail = Math.round(c.totalRooms * 0.18 + normal() * 0.8);
    return clamp(avail, 0, c.totalRooms);
  };
  for (const d of dateRange(addDays(opts.asOf, -12), opts.asOf)) {
    const live = d === opts.asOf;
    for (const c of profile.categories)
      for (let k = 0; k < 7; k++) {
        const stay = addDays(d, k);
        const avail = remaining(c.id, stay, k, live && opts.scenario);
        if (live) invWebhooks.push({ event: 'inventory.updated', occurredAt: iso(d, 20, 0), data: { roomType: c.id, date: stay, total: c.totalRooms, available: avail } });
        else invRows.push(`${hhmm(d, 20)},${c.id},${stay},${c.totalRooms},${avail}`);
      }
  }

  /* ---- promotion that runs for a week and ends on asOf ---- */
  const promo = (active: boolean, ts: string): PromotionObservation => ({
    kind: 'promotion', source: 'booking-engine', ts: parseTimestamp(ts, profile.tzOffsetMinutes), promoId: 'staycation', name: 'Weekend Staycation', active, discountPct: 10,
  });
  const promotions = [promo(true, hhmm(addDays(opts.asOf, -9), 9)), promo(false, hhmm(opts.asOf, 0, 5))];

  return {
    profile,
    start,
    asOf: opts.asOf,
    history: { reservationsCsv: reservationRows.join('\n'), dailyReportCsv: dailyRows.join('\n'), rateShopCsv: rateRows.join('\n'), inventoryCsv: invRows.join('\n'), promotions },
    live: { webhooks: [...webhooks, ...invWebhooks], meterReadings, rateShop: liveRates, dailyReportCsv: liveDailyRows.join('\n') },
  };
};
