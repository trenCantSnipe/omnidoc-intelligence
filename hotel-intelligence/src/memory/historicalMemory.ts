import type { BaselineEngine } from '../baseline/baselineEngine';
import type { EventStore } from '../store/eventStore';
import type { MetricStore } from '../store/metricStore';
import type { DateKey, DayReport, HotelEvent, Recommendation, Situation } from '../types';
import { mean, round } from '../util/stats';
import { addDays } from '../util/time';

export interface Episode {
  date: DateKey;
  value: number;
  adr?: number;
  revenue?: number;
  revenueVsExpectedPct?: number;
  cancellationRate?: number;
  nextDayOccupancy?: number;
  /** What was going on around that day: price moves, competitor moves, promotions. */
  context: HotelEvent[];
}

export interface ActionOutcome {
  recommendationId: string;
  category?: string;
  verdict: 'worked' | 'hurt_demand' | 'inconclusive' | 'too_early';
  evidence: string;
}

/**
 * The hotel's long-term operational memory: what normally happens, what happened before in
 * situations like this one, and what came of the actions taken. It is built from the same
 * event/metric stores as everything else, so there is no separate data to keep in sync.
 */
export class HistoricalMemory {
  private situations: Situation[] = [];
  private recommendations = new Map<string, Recommendation>();
  private outcomes = new Map<string, ActionOutcome>();

  constructor(
    private metrics: MetricStore,
    private events: EventStore,
    private baseline: BaselineEngine,
  ) {}

  record(report: DayReport): void {
    this.situations.push(...report.situations);
    for (const r of report.recommendations) this.recommendations.set(r.id, r);
  }

  /** Earlier situations of the same kind (and category) — "have we seen this before?" */
  similarSituations(s: Situation): Situation[] {
    return this.situations.filter((x) => x.kind === s.kind && x.category === s.category && x.date < s.date);
  }

  /** Days on which `metric` satisfied `predicate`, with the surrounding context. Most recent first. */
  episodes(metric: string, predicate: (v: number) => boolean, limit = 10): Episode[] {
    return this.metrics
      .series(metric)
      .filter(([, v]) => predicate(v))
      .reverse()
      .slice(0, limit)
      .map(([date, value]) => {
        const revenue = this.metrics.get('revenue', date);
        const exp = revenue !== undefined ? this.baseline.expect('revenue', date)?.expected : undefined;
        return {
          date,
          value,
          adr: this.metrics.get('adr', date),
          revenue,
          revenueVsExpectedPct: revenue !== undefined && exp ? round(((revenue - exp) / exp) * 100, 1) : undefined,
          cancellationRate: this.metrics.get('cancellation_rate', date),
          nextDayOccupancy: this.metrics.get('occupancy_pct', addDays(date, 1)),
          context: this.events.query({ fromDate: addDays(date, -1), toDate: date, minSignificance: 'notable' }).filter(
            (e) => ['PRICE_CHANGED', 'COMPETITOR_PRICE_CHANGED', 'PROMOTION_STARTED', 'PROMOTION_ENDED', 'CANCELLATION_SPIKE', 'ELECTRICITY_SPIKE'].includes(e.type),
          ),
        };
      });
  }

  summarizeEpisodes(label: string, episodes: Episode[]): string {
    if (!episodes.length) return `No earlier day matches ${label} in the hotel's recorded history.`;
    const adrs = episodes.map((e) => e.adr).filter((x): x is number => x !== undefined);
    const dev = episodes.map((e) => e.revenueVsExpectedPct).filter((x): x is number => x !== undefined);
    const canc = episodes.map((e) => e.cancellationRate).filter((x): x is number => x !== undefined);
    const next = episodes.map((e) => e.nextDayOccupancy).filter((x): x is number => x !== undefined);
    const priceMoves = episodes.filter((e) => e.context.some((c) => c.type === 'PRICE_CHANGED')).length;
    const parts = [`${label} happened ${episodes.length} time${episodes.length > 1 ? 's' : ''} (most recent ${episodes[0].date}).`];
    if (adrs.length) parts.push(`Average ADR on those days was ₹${Math.round(mean(adrs)).toLocaleString('en-IN')}.`);
    if (dev.length) parts.push(`Revenue ran ${round(mean(dev), 0)}% vs expected on average.`);
    if (canc.length) parts.push(`Cancellation rate averaged ${round(mean(canc), 1)}%.`);
    if (next.length) parts.push(`The following day's occupancy averaged ${round(mean(next), 0)}%.`);
    parts.push(priceMoves ? `The hotel changed its own rates around ${priceMoves} of those days.` : 'No own-rate changes were recorded around those days.');
    return parts.join(' ');
  }

  /**
   * Did an executed price action work? Looks at the following days' booking pace and ADR for the
   * category against baseline. A heuristic judgement stored with its evidence, so over time the
   * hotel accumulates "what worked here" rather than generic revenue-management lore.
   */
  evaluateOutcome(rec: Recommendation, asOf: DateKey, horizonDays = 3): ActionOutcome {
    const cat = String(rec.params.category ?? '');
    const days = Array.from({ length: horizonDays }, (_, i) => addDays(rec.createdForDate, i + 1)).filter((d) => d <= asOf);
    if (days.length < horizonDays) return this.store({ recommendationId: rec.id, category: cat, verdict: 'too_early', evidence: `only ${days.length}/${horizonDays} follow-up days observed` });
    const pace: number[] = [];
    const adr: number[] = [];
    for (const d of days) {
      const p = this.metrics.get(`pickup:${cat}`, d);
      const e = this.baseline.expect(`pickup:${cat}`, d)?.expected;
      if (p !== undefined && e) pace.push(p / e);
      const a = this.metrics.get('adr', d);
      const ae = this.baseline.expect('adr', d)?.expected;
      if (a !== undefined && ae) adr.push(a / ae);
    }
    if (!pace.length) return this.store({ recommendationId: rec.id, category: cat, verdict: 'inconclusive', evidence: 'no follow-up pickup data' });
    const m = mean(pace);
    const a = adr.length ? mean(adr) : 1;
    const verdict: ActionOutcome['verdict'] = m >= 0.85 && a >= 1 ? 'worked' : m < 0.6 ? 'hurt_demand' : 'inconclusive';
    return this.store({
      recommendationId: rec.id,
      category: cat,
      verdict,
      evidence: `over the next ${days.length} days ${cat} booking pace was ${round(m, 2)}× normal and ADR ${round((a - 1) * 100, 1)}% vs expected`,
    });
  }

  outcomeFor(recId: string): ActionOutcome | undefined {
    return this.outcomes.get(recId);
  }

  private store(o: ActionOutcome): ActionOutcome {
    this.outcomes.set(o.recommendationId, o);
    return o;
  }
}
