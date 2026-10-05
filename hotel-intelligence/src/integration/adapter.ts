import type { HotelProfile, Observation } from '../types';

export interface AdapterContext {
  profile: HotelProfile;
}

/**
 * A SourceAdapter turns one vendor-specific payload (a webhook body, a CSV file, an API response)
 * into normalized Observations. Adapters are pure: no I/O, no state. That keeps them trivially
 * testable and lets a new PMS be supported by writing one mapping function.
 */
export interface SourceAdapter<Raw = unknown> {
  readonly id: string;
  readonly description: string;
  parse(raw: Raw, ctx: AdapterContext): Observation[];
}

/** Adapters that can also poll their source (scheduled API pulls). The platform never requires this. */
export interface PullAdapter<Raw = unknown> extends SourceAdapter<Raw> {
  fetch(sinceTs: number): Promise<Raw[]>;
}

export class AdapterRegistry {
  private adapters = new Map<string, SourceAdapter<any>>();

  register<Raw>(adapter: SourceAdapter<Raw>): this {
    if (this.adapters.has(adapter.id)) throw new Error(`Adapter already registered: ${adapter.id}`);
    this.adapters.set(adapter.id, adapter);
    return this;
  }

  get(id: string): SourceAdapter<any> {
    const a = this.adapters.get(id);
    if (!a) throw new Error(`Unknown adapter: ${id}`);
    return a;
  }

  list(): { id: string; description: string }[] {
    return [...this.adapters.values()].map((a) => ({ id: a.id, description: a.description }));
  }
}

/** Error carrying row context so a bad line in a 10k-row export is findable. */
export class AdapterParseError extends Error {
  constructor(adapterId: string, detail: string) {
    super(`[${adapterId}] ${detail}`);
  }
}

export const num = (adapterId: string, field: string, v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[₹,\s]/g, ''));
  if (!Number.isFinite(n)) throw new AdapterParseError(adapterId, `field "${field}" is not a number: ${String(v)}`);
  return n;
};
