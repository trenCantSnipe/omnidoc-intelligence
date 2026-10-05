import { parseCsv } from '../util/csv';
import { parseTimestamp } from '../util/time';
import type { Observation } from '../types';
import { AdapterParseError, num, type SourceAdapter } from './adapter';

/**
 * CSV adapters cover the "scheduled report / Excel export" integrations that most legacy PMSs offer.
 * Column names are configurable so a hotel's existing export works without reformatting.
 * (Excel files: save as CSV, or convert upstream; the adapter contract is the same.)
 */

type Row = Record<string, string>;

const col = (adapterId: string, row: Row, name: string): string => {
  const v = row[name];
  if (v === undefined) throw new AdapterParseError(adapterId, `missing column "${name}"`);
  return v;
};

export interface ReservationCsvColumns {
  bookingId: string;
  /** When the booking/cancellation happened. */
  timestamp: string;
  status: string;
  category: string;
  amount: string;
  nights: string;
  channel: string;
  stayDate: string;
  roomId?: string;
}

const DEFAULT_RESERVATION_COLUMNS: ReservationCsvColumns = {
  bookingId: 'booking_id',
  timestamp: 'timestamp',
  status: 'status',
  category: 'category',
  amount: 'amount',
  nights: 'nights',
  channel: 'channel',
  stayDate: 'stay_date',
  roomId: 'room_id',
};

export const reservationsCsvAdapter = (
  id = 'csv.reservations',
  columns: Partial<ReservationCsvColumns> = {},
  statusMap: Record<string, 'confirmed' | 'cancelled'> = {
    confirmed: 'confirmed',
    booked: 'confirmed',
    cancelled: 'cancelled',
    canceled: 'cancelled',
  },
): SourceAdapter<string> => {
  const c = { ...DEFAULT_RESERVATION_COLUMNS, ...columns };
  return {
    id,
    description: 'Reservation export (CSV): one row per booking or cancellation',
    parse(text, { profile }) {
      return parseCsv(text).map((row, i): Observation => {
        const status = statusMap[col(id, row, c.status).toLowerCase()];
        if (!status) throw new AdapterParseError(id, `row ${i + 2}: unknown status "${row[c.status]}"`);
        return {
          kind: 'booking',
          source: id,
          ts: parseTimestamp(col(id, row, c.timestamp), profile.tzOffsetMinutes),
          bookingId: col(id, row, c.bookingId),
          status,
          category: col(id, row, c.category),
          roomId: c.roomId ? row[c.roomId] || undefined : undefined,
          amount: num(id, c.amount, col(id, row, c.amount)),
          nights: num(id, c.nights, col(id, row, c.nights)),
          channel: col(id, row, c.channel),
          stayDate: col(id, row, c.stayDate).slice(0, 10),
        };
      });
    },
  };
};

/**
 * Wide daily report: one row per business date, with a configurable column -> metric mapping.
 * e.g. { occupancy: 'occupancy_pct', 'Room Revenue': 'revenue', 'Power (kWh)': 'electricity_kwh' }
 */
export const dailyReportCsvAdapter = (
  id = 'csv.daily_report',
  dateColumn = 'date',
  metricColumns: Record<string, string> = {},
): SourceAdapter<string> => ({
  id,
  description: 'Daily management report (CSV): one row per business date, one column per metric',
  parse(text, { profile }) {
    const out: Observation[] = [];
    for (const row of parseCsv(text)) {
      const date = col(id, row, dateColumn).slice(0, 10);
      // Reports are produced at night audit; stamp at 23:59 local so ordering vs. same-day events is stable.
      const ts = parseTimestamp(`${date} 23:59:00`, profile.tzOffsetMinutes);
      for (const [column, metric] of Object.entries(metricColumns)) {
        if (row[column] === undefined || row[column] === '') continue;
        out.push({ kind: 'metric', source: id, ts, metric, date, value: num(id, column, row[column]) });
      }
    }
    return out;
  },
});

export const rateShopCsvAdapter = (id = 'csv.rate_shop'): SourceAdapter<string> => ({
  id,
  description: 'Rate snapshots (CSV): timestamp,party,provider,category,price',
  parse(text, { profile }) {
    return parseCsv(text).map((row): Observation => {
      const party = col(id, row, 'party');
      if (party !== 'own_direct' && party !== 'own_ota' && party !== 'competitor')
        throw new AdapterParseError(id, `unknown party "${party}"`);
      return {
        kind: 'rate',
        source: id,
        ts: parseTimestamp(col(id, row, 'timestamp'), profile.tzOffsetMinutes),
        party,
        provider: row.provider || undefined,
        category: col(id, row, 'category'),
        price: num(id, 'price', col(id, row, 'price')),
      };
    });
  },
});

export const inventoryCsvAdapter = (id = 'csv.inventory'): SourceAdapter<string> => ({
  id,
  description: 'Availability snapshots (CSV): timestamp,category,stay_date,total,available',
  parse(text, { profile }) {
    return parseCsv(text).map(
      (row): Observation => ({
        kind: 'inventory',
        source: id,
        ts: parseTimestamp(col(id, row, 'timestamp'), profile.tzOffsetMinutes),
        category: col(id, row, 'category'),
        stayDate: col(id, row, 'stay_date').slice(0, 10),
        total: num(id, 'total', col(id, row, 'total')),
        available: num(id, 'available', col(id, row, 'available')),
      }),
    );
  },
});
