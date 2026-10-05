import type { DateKey, EventType, HotelEvent, Scalar, Significance } from '../types';
import { fnv1a } from '../util/stats';

export interface NewEvent {
  hotelId: string;
  type: EventType;
  ts: number;
  date: DateKey;
  source: string;
  payload: Record<string, Scalar>;
  /** Identity of the real-world fact; replays of the same fact collapse into one event. */
  dedupeKey: string;
  significance?: Significance;
  reasons?: string[];
}

export const makeEvent = (e: NewEvent): HotelEvent => ({
  id: `evt_${fnv1a(`${e.hotelId}|${e.type}|${e.dedupeKey}`)}`,
  hotelId: e.hotelId,
  type: e.type,
  ts: e.ts,
  date: e.date,
  source: e.source,
  payload: e.payload,
  significance: e.significance ?? 'noise',
  reasons: e.reasons ?? [],
});
