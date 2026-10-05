import type { DateKey, RateObservation } from '../types';

interface Stamped<T> {
  ts: number;
  value: T;
}

export interface InventoryState {
  total: number;
  available: number;
}

export interface RateKey {
  party: RateObservation['party'];
  provider?: string;
  category: string;
  roomId?: string;
}

const rateKeyStr = (k: RateKey): string => `${k.party}|${k.provider ?? ''}|${k.category}|${k.roomId ?? ''}`;

const lastAtOrBefore = <T>(list: Stamped<T>[] | undefined, ts: number): Stamped<T> | undefined => {
  if (!list) return undefined;
  for (let i = list.length - 1; i >= 0; i--) if (list[i].ts <= ts) return list[i];
  return undefined;
};

const pushSorted = <T>(list: Stamped<T>[], item: Stamped<T>): void => {
  list.push(item);
  // Backfills arrive in order in practice; only pay for sorting when they don't.
  if (list.length > 1 && list[list.length - 2].ts > item.ts) list.sort((a, b) => a.ts - b.ts);
};

/**
 * Versioned "current state" of the hotel's market position (rates, availability, promotions).
 * Every value is kept with its timestamp so the context engine can ask "what did the market look
 * like at the end of that day?" — which is what lets history be replayed faithfully.
 */
export class StateStore {
  private rates = new Map<string, { key: RateKey; history: Stamped<number>[] }>();
  private inventory = new Map<string, Stamped<InventoryState>[]>();
  private promos = new Map<string, Stamped<boolean>[]>();

  /** Records a rate and returns the value that was in force just before it (if any). */
  applyRate(key: RateKey, price: number, ts: number): number | undefined {
    const ks = rateKeyStr(key);
    let entry = this.rates.get(ks);
    if (!entry) this.rates.set(ks, (entry = { key, history: [] }));
    const prev = lastAtOrBefore(entry.history, ts)?.value;
    pushSorted(entry.history, { ts, value: price });
    return prev;
  }

  applyInventory(category: string, stayDate: DateKey, state: InventoryState, ts: number): InventoryState | undefined {
    const ks = `${category}|${stayDate}`;
    let h = this.inventory.get(ks);
    if (!h) this.inventory.set(ks, (h = []));
    const prev = lastAtOrBefore(h, ts)?.value;
    pushSorted(h, { ts, value: state });
    return prev;
  }

  applyPromotion(promoId: string, active: boolean, ts: number): boolean {
    let h = this.promos.get(promoId);
    if (!h) this.promos.set(promoId, (h = []));
    const prev = lastAtOrBefore(h, ts)?.value ?? false;
    pushSorted(h, { ts, value: active });
    return prev;
  }

  rateAt(key: RateKey, ts: number): number | undefined {
    return lastAtOrBefore(this.rates.get(rateKeyStr(key))?.history, ts)?.value;
  }

  /** Latest price per competitor for a category, as of `ts`. */
  competitorRatesAt(category: string, ts: number): { competitor: string; price: number }[] {
    const out: { competitor: string; price: number }[] = [];
    for (const { key, history } of this.rates.values()) {
      if (key.party !== 'competitor' || key.category !== category) continue;
      const v = lastAtOrBefore(history, ts);
      if (v) out.push({ competitor: key.provider ?? 'unknown', price: v.value });
    }
    return out;
  }

  ownRateAt(party: 'own_direct' | 'own_ota', category: string, ts: number): number | undefined {
    // Category-level rate (no roomId). OTA rates may be keyed per provider; take the lowest live one.
    const prices: number[] = [];
    for (const { key, history } of this.rates.values()) {
      if (key.party !== party || key.category !== category || key.roomId) continue;
      const v = lastAtOrBefore(history, ts);
      if (v) prices.push(v.value);
    }
    return prices.length ? Math.min(...prices) : undefined;
  }

  inventoryAt(category: string, stayDate: DateKey, ts: number): InventoryState | undefined {
    return lastAtOrBefore(this.inventory.get(`${category}|${stayDate}`), ts)?.value;
  }
}
