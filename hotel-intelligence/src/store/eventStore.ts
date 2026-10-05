import type { DateKey, EventType, HotelEvent, Significance } from '../types';
import { SIGNIFICANCE_RANK } from '../types';

export interface EventQuery {
  types?: EventType[];
  fromTs?: number;
  toTs?: number;
  fromDate?: DateKey;
  toDate?: DateKey;
  minSignificance?: Significance;
}

/**
 * Append-only event log. In production this interface is backed by a durable store
 * (Postgres/ClickHouse/Kafka + object storage); the in-memory version keeps the engine testable.
 * Appends are idempotent by event id, so webhook retries and re-imported exports never double count.
 */
export class EventStore {
  private events: HotelEvent[] = [];
  private ids = new Set<string>();

  /** Returns false when the event was already present. */
  append(e: HotelEvent): boolean {
    if (this.ids.has(e.id)) return false;
    this.ids.add(e.id);
    this.events.push(e);
    return true;
  }

  get size(): number {
    return this.events.length;
  }

  query(q: EventQuery = {}): HotelEvent[] {
    const min = q.minSignificance ? SIGNIFICANCE_RANK[q.minSignificance] : 0;
    return this.events
      .filter(
        (e) =>
          (!q.types || q.types.includes(e.type)) &&
          (q.fromTs === undefined || e.ts >= q.fromTs) &&
          (q.toTs === undefined || e.ts <= q.toTs) &&
          (!q.fromDate || e.date >= q.fromDate) &&
          (!q.toDate || e.date <= q.toDate) &&
          SIGNIFICANCE_RANK[e.significance] >= min,
      )
      .sort((a, b) => a.ts - b.ts);
  }

  byId(id: string): HotelEvent | undefined {
    return this.events.find((e) => e.id === id);
  }
}
