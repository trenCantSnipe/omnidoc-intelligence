/** Hotel-local calendar helpers. A DateKey is `YYYY-MM-DD` in the hotel's local time. */
export type DateKey = string;

const DAY_MS = 86_400_000;

export const toDateKey = (ts: number, tzOffsetMinutes: number): DateKey =>
  new Date(ts + tzOffsetMinutes * 60_000).toISOString().slice(0, 10);

const keyToUtcMs = (k: DateKey): number => Date.parse(`${k}T00:00:00Z`);

export const addDays = (k: DateKey, n: number): DateKey =>
  new Date(keyToUtcMs(k) + n * DAY_MS).toISOString().slice(0, 10);

export const dayOfWeek = (k: DateKey): number => new Date(keyToUtcMs(k)).getUTCDay();

export const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const dowName = (k: DateKey): string => DOW_NAMES[dayOfWeek(k)];

/** Epoch ms of local midnight at the start of the day. */
export const dayStart = (k: DateKey, tzOffsetMinutes: number): number =>
  keyToUtcMs(k) - tzOffsetMinutes * 60_000;

export const dayEnd = (k: DateKey, tzOffsetMinutes: number): number =>
  dayStart(k, tzOffsetMinutes) + DAY_MS - 1;

export const daysBetween = (from: DateKey, to: DateKey): number =>
  Math.round((keyToUtcMs(to) - keyToUtcMs(from)) / DAY_MS);

export const dateRange = (from: DateKey, to: DateKey): DateKey[] => {
  const out: DateKey[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};

/**
 * Parses timestamps from source systems. Strings with a `Z`/offset are absolute; naive
 * `YYYY-MM-DD[ T]HH:mm[:ss]` strings are interpreted in hotel-local time; a bare date is local midnight.
 */
export const parseTimestamp = (s: string, tzOffsetMinutes: number): number => {
  const str = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return dayStart(str, tzOffsetMinutes);
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(str)) {
    const t = Date.parse(str);
    if (!Number.isNaN(t)) return t;
  } else {
    const t = Date.parse(`${str.replace(' ', 'T')}Z`);
    if (!Number.isNaN(t)) return t - tzOffsetMinutes * 60_000;
  }
  throw new Error(`Unparseable timestamp: "${s}"`);
};
