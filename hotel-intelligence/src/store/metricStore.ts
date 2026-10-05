import type { DateKey } from '../types';

/** Daily metric time series, keyed by metric id. */
export class MetricStore {
  private data = new Map<string, Map<DateKey, number>>();

  set(metric: string, date: DateKey, value: number): void {
    this.bucket(metric).set(date, value);
  }

  add(metric: string, date: DateKey, value: number): void {
    const b = this.bucket(metric);
    b.set(date, (b.get(date) ?? 0) + value);
  }

  get(metric: string, date: DateKey): number | undefined {
    return this.data.get(metric)?.get(date);
  }

  /** Sorted [date, value] pairs, optionally bounded (inclusive). */
  series(metric: string, from?: DateKey, to?: DateKey): [DateKey, number][] {
    const b = this.data.get(metric);
    if (!b) return [];
    return [...b.entries()].filter(([d]) => (!from || d >= from) && (!to || d <= to)).sort((a, b2) => (a[0] < b2[0] ? -1 : 1));
  }

  metrics(): string[] {
    return [...this.data.keys()];
  }

  private bucket(metric: string): Map<DateKey, number> {
    let b = this.data.get(metric);
    if (!b) this.data.set(metric, (b = new Map()));
    return b;
  }
}
