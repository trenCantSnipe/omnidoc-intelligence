import type { BaselineEngine } from '../baseline/baselineEngine';
import { METRIC_SPECS } from '../baseline/metricSpecs';
import { describePriceAction } from '../decision/decisionEngine';
import type { HistoricalMemory } from '../memory/historicalMemory';
import type { EventStore } from '../store/eventStore';
import type { MetricStore } from '../store/metricStore';
import type { DateKey, DayReport, HotelProfile } from '../types';
import { count, formatMetric, money, mult, pct, signedPct } from '../util/format';
import { round, sum } from '../util/stats';
import { addDays, dowName } from '../util/time';
import { PlainNarrator, type Narrator } from './narrator';

export type Intent =
  | 'recall'
  | 'focus'
  | 'what_changed'
  | 'explain_metric'
  | 'pricing_advice'
  | 'best_category'
  | 'freeform';

export interface Answer {
  question: string;
  intent: Intent;
  text: string;
  /** Structured facts the text was built from; also what an LLM narrator is grounded in. */
  facts: Record<string, unknown>;
}

export interface CopilotContext {
  profile: HotelProfile;
  metrics: MetricStore;
  events: EventStore;
  baseline: BaselineEngine;
  memory: HistoricalMemory;
  asOf(): DateKey | null;
  report(date: DateKey): DayReport | undefined;
}

const TOPICS: { re: RegExp; metric: string }[] = [
  { re: /electric|power|kwh|energy/, metric: 'electricity_kwh' },
  { re: /water/, metric: 'water_kl' },
  { re: /cancel/, metric: 'cancellations' },
  { re: /revenue|sales|income/, metric: 'revenue' },
  { re: /occupan/, metric: 'occupancy_pct' },
  { re: /\badr\b|average (daily )?rate/, metric: 'adr' },
  { re: /maintenance|repair/, metric: 'maintenance_cost' },
  { re: /staff|payroll|labou?r/, metric: 'staff_cost' },
  { re: /expens|cost|spend/, metric: 'expenses' },
  { re: /wastage|waste|food|f&b|kitchen/, metric: 'fnb_wastage' },
  { re: /booking/, metric: 'bookings' },
];

/**
 * Natural-language interface. Questions are routed to deterministic analyses over the hotel's real
 * history; the answer is composed from those results. A Narrator (LLM) may then rephrase it, but is
 * handed the same facts and instructed not to add any, so the copilot cannot hallucinate numbers
 * the engines did not produce.
 */
export class Copilot {
  constructor(
    private ctx: CopilotContext,
    private narrator: Narrator = new PlainNarrator(),
  ) {}

  async ask(question: string): Promise<Answer> {
    const draft = this.answer(question);
    const text = await this.narrator.narrate({
      task: draft.intent === 'freeform' ? 'freeform' : 'answer',
      question,
      draft: draft.intent === 'freeform' ? '' : draft.text,
      facts: draft.facts,
    });
    return { ...draft, text: text || draft.text };
  }

  /** Deterministic part, exposed for tests and for callers that do not want an LLM in the loop. */
  answer(question: string): Answer {
    const q = question.toLowerCase();
    const asOf = this.ctx.asOf();
    if (!asOf) return this.mk(question, 'freeform', 'No days have been analysed yet.', {});

    if (/last time|previous(ly)? .*(reach|hit)|what happened when/.test(q)) return this.recall(question, q);
    if (/focus|priorit|what should i (do|look)|where should/.test(q)) return this.focus(question, asOf);
    if (/(should|can|could) (we|i) .*(increase|raise|hike|lower|cut|drop|change|reduce).*(price|rate|tariff)|price.*(increase|raise)|pricing/.test(q))
      return this.pricing(question, asOf);
    if (/which .*(categor|room type|room).*(best|perform|top|selling|strong)|best (performing )?(room|categor)/.test(q)) return this.bestCategory(question, asOf);
    if (/what.*(changed|happened|new)|overnight|since yesterday|summary/.test(q)) return this.whatChanged(question, asOf);
    const topic = TOPICS.find((t) => t.re.test(q));
    if (topic && /why|how come|reason|explain|increas|decreas|fall|fell|drop|rise|spike|high|low|unusual/.test(q))
      return this.explain(question, topic.metric, asOf);
    if (topic) return this.explain(question, topic.metric, asOf);
    return this.mk(question, 'freeform', '', this.snapshot(asOf));
  }

  /* ------------------------------------------------------------ */

  private mk(question: string, intent: Intent, text: string, facts: Record<string, unknown>): Answer {
    return { question, intent, text, facts };
  }

  private snapshot(asOf: DateKey): Record<string, unknown> {
    const r = this.ctx.report(asOf);
    return {
      asOf,
      weekday: dowName(asOf),
      kpis: (r?.evaluations ?? []).map((e) => ({ metric: e.label, observed: round(e.observed, 1), expected: round(e.expected, 1), deviationPct: round(e.deviationPct, 1), status: e.classification })),
      alerts: (r?.surfaced ?? []).map((a) => ({ tier: a.tier, title: a.title, detail: a.body })),
      recommendations: (r?.recommendations ?? []).map((x) => ({ title: x.title, rationale: x.rationale, status: x.status })),
    };
  }

  private whatChanged(question: string, asOf: DateKey): Answer {
    const r = this.ctx.report(asOf);
    if (!r) return this.mk(question, 'what_changed', `No analysis is available for ${asOf} yet.`, {});
    const lines: string[] = [`Here is what changed on ${dowName(asOf)} ${asOf}:`];
    const moved = r.evaluations.filter((e) => e.classification === 'actionable' || e.classification === 'watch');
    for (const e of moved) lines.push(`- ${e.label}: ${formatMetric(e.unit, e.observed)} vs ${formatMetric(e.unit, e.expected)} expected (${signedPct(e.deviationPct, 0)})${e.classification === 'watch' ? ' — worth watching' : ''}`);
    if (!moved.length) lines.push('- No metric deviated meaningfully from this hotel\'s normal range.');
    const evs = r.notableEvents.filter((e) => !['ELECTRICITY_SPIKE', 'REVENUE_ANOMALY', 'CANCELLATION_SPIKE', 'EXPENSE_ANOMALY', 'ROOM_CATEGORY_SELLING_FAST', 'ROOM_CATEGORY_SELLING_SLOW', 'METRIC_ANOMALY'].includes(e.type));
    for (const e of evs.slice(0, 8)) lines.push(`- ${describeEvent(e.type, e.payload, this.ctx.profile)}`);
    if (r.surfaced.length) lines.push('', 'What matters most:', ...r.surfaced.slice(0, 3).map((a) => `- [${a.tier}] ${a.title}`));
    return this.mk(question, 'what_changed', lines.join('\n'), this.snapshot(asOf));
  }

  private explain(question: string, metric: string, asOf: DateKey): Answer {
    const spec = METRIC_SPECS[metric];
    const r = this.ctx.report(asOf);
    const ev = r?.evaluations.find((e) => e.metric === metric);
    if (!spec || !ev) return this.mk(question, 'explain_metric', `I don't have ${spec?.label ?? metric} for ${asOf}.`, {});
    const prior = this.ctx.metrics.get(metric, addDays(asOf, -1));
    const sit = r!.situations.find((s) => s.anomalyIds.includes(ev.id) && s.metric === metric) ?? r!.situations.find((s) => s.anomalyIds.includes(ev.id));
    const lines: string[] = [];
    if (sit) {
      lines.push(sit.summary);
      const rec = r!.recommendations.find((x) => x.situationId === sit.id);
      if (rec) lines.push(`Suggested next step: ${rec.title}.`);
    } else {
      lines.push(
        `${spec.label} on ${dowName(asOf)} ${asOf} was ${formatMetric(ev.unit, ev.observed)}, ${ev.classification === 'normal' ? 'within' : 'outside'} this hotel's normal range for the day (expected ${formatMetric(ev.unit, ev.expected)}, range ${formatMetric(ev.unit, ev.lower)}–${formatMetric(ev.unit, ev.upper)}).`,
      );
      if (prior !== undefined && Math.abs(prior) > 0) lines.push(`That is ${signedPct(((ev.observed - prior) / prior) * 100, 0)} vs the previous day (${formatMetric(ev.unit, prior)}), which ${ev.classification === 'normal' ? 'is ordinary day-to-day and weekday variation' : 'is not explained by the usual pattern'}.`);
    }
    if (ev.drivers.length) lines.push(`Expectation accounts for ${ev.drivers.map((d) => d.name.replace('_', ' ')).join(', ')}.`);
    return this.mk(question, 'explain_metric', lines.join(' '), { metric, evaluation: ev, situation: sit?.summary });
  }

  private pricing(question: string, asOf: DateKey): Answer {
    const r = this.ctx.report(asOf);
    const recs = (r?.recommendations ?? []).filter((x) => x.type === 'ADJUST_PRICE');
    const lines: string[] = [];
    if (recs.length) {
      lines.push(`Based on ${asOf}'s data, here ${recs.length === 1 ? 'is' : 'are'} the pricing action${recs.length > 1 ? 's' : ''} I would consider:`);
      for (const x of recs) lines.push(`- ${x.title}${describePriceAction(x) ? ` (${describePriceAction(x)})` : ''}. ${x.rationale} Status: ${x.status}.`);
    } else {
      lines.push('There is no strong signal to change room rates today: no category is selling meaningfully faster or slower than its normal pace.');
      const paces = this.ctx.profile.categories.map((c) => {
        const e = r?.evaluations.find((x) => x.metric === `pickup:${c.id}`);
        return e ? `${c.name} ${mult(e.observed / Math.max(e.expected, 0.5))} normal pace` : undefined;
      });
      const shown = paces.filter(Boolean);
      if (shown.length) lines.push(`Booking pace: ${shown.join(', ')}.`);
    }
    return this.mk(question, 'pricing_advice', lines.join('\n'), { recommendations: recs.map((x) => ({ title: x.title, params: x.params, rationale: x.rationale, status: x.status })) });
  }

  private bestCategory(question: string, asOf: DateKey): Answer {
    const from = addDays(asOf, -6);
    const booked = this.ctx.events.query({ fromDate: from, toDate: asOf, types: ['ROOM_BOOKED'] });
    const rows = this.ctx.profile.categories.map((c) => {
      const evs = booked.filter((e) => e.payload.category === c.id);
      const revenue = sum(evs.map((e) => Number(e.payload.amount)));
      let pace = 0;
      let expected = 0;
      for (let i = 0; i < 7; i++) {
        const d = addDays(from, i);
        const v = this.ctx.metrics.get(`pickup:${c.id}`, d);
        const e = this.ctx.baseline.expect(`pickup:${c.id}`, d)?.expected;
        if (v !== undefined && e) {
          pace += v;
          expected += e;
        }
      }
      return { id: c.id, name: c.name, bookings: evs.length, revenue, paceMultiple: expected ? pace / expected : NaN };
    });
    const total = sum(rows.map((r) => r.revenue)) || 1;
    rows.sort((a, b) => b.revenue - a.revenue);
    const lines = [
      `Over the last 7 days (to ${asOf}), by booked value:`,
      ...rows.map((r, i) => `${i + 1}. ${r.name}: ${money(r.revenue)} (${pct((r.revenue / total) * 100, 0)} of the total) from ${count(r.bookings)} bookings${Number.isFinite(r.paceMultiple) ? `, booking pace ${mult(r.paceMultiple)} normal` : ''}`),
    ];
    const hottest = [...rows].filter((r) => Number.isFinite(r.paceMultiple)).sort((a, b) => b.paceMultiple - a.paceMultiple)[0];
    if (hottest && hottest.id !== rows[0].id) lines.push(`Note: ${hottest.name} has the strongest momentum relative to its normal pace.`);
    return this.mk(question, 'best_category', lines.join('\n'), { rows });
  }

  private focus(question: string, asOf: DateKey): Answer {
    const r = this.ctx.report(asOf);
    if (!r || (!r.surfaced.length && !r.recommendations.length))
      return this.mk(question, 'focus', 'Nothing is flagged: all monitored metrics are within normal range. A good day to review longer-term items.', this.snapshot(asOf));
    const lines = ['Focus on these, in order of business impact:'];
    r.surfaced.slice(0, 4).forEach((a, i) => {
      lines.push(`${i + 1}. [${a.tier}] ${a.title}`);
      for (const id of a.recommendationIds) {
        const rec = r.recommendations.find((x) => x.id === id);
        if (rec) lines.push(`   → ${rec.title}${describePriceAction(rec) ? ` — ${describePriceAction(rec)}` : ''}`);
      }
    });
    return this.mk(question, 'focus', lines.join('\n'), this.snapshot(asOf));
  }

  private recall(question: string, q: string): Answer {
    const m = q.match(/(\d{2,3})\s*%?/);
    const topic = TOPICS.find((t) => t.re.test(q));
    const metric = topic?.metric ?? 'occupancy_pct';
    const threshold = m ? Number(m[1]) : undefined;
    if (threshold === undefined) return this.mk(question, 'recall', 'Tell me which level to look for, for example "what happened the last time occupancy reached 90%".', {});
    const eps = this.ctx.memory.episodes(metric, (v) => v >= threshold);
    const label = `${METRIC_SPECS[metric]?.label ?? metric} reaching ${threshold}${METRIC_SPECS[metric]?.unit === '%' ? '%' : ''}`;
    return this.mk(question, 'recall', this.ctx.memory.summarizeEpisodes(label, eps), {
      metric,
      threshold,
      episodes: eps.map((e) => ({ date: e.date, value: e.value, adr: e.adr, revenueVsExpectedPct: e.revenueVsExpectedPct, cancellationRate: e.cancellationRate, nextDayOccupancy: e.nextDayOccupancy })),
    });
  }
}

const describeEvent = (type: string, p: Record<string, unknown>, profile: HotelProfile): string => {
  const compName = (id: unknown): string => profile.competitors.find((c) => c.id === id)?.name ?? String(id);
  const catName = (id: unknown): string => profile.categories.find((c) => c.id === id)?.name ?? String(id);
  switch (type) {
    case 'PRICE_CHANGED':
      return `Own ${p.categoryName} rate (${String(p.party).replace('own_', '')}) ${money(Number(p.oldPrice))} → ${money(Number(p.newPrice))} (${signedPct(Number(p.changePct), 1)})`;
    case 'COMPETITOR_PRICE_CHANGED':
      return `${compName(p.provider)} ${p.categoryName} rate ${money(Number(p.oldPrice))} → ${money(Number(p.newPrice))} (${signedPct(Number(p.changePct), 1)})`;
    case 'INVENTORY_CHANGED':
      return `${catName(p.category)} availability for ${p.stayDate}: ${p.from} → ${p.to} rooms (${p.remainingPct}% left)`;
    case 'OCCUPANCY_CHANGED':
      return `Occupancy ${p.from}% → ${p.to}% (${Number(p.deltaPts) >= 0 ? '+' : ''}${p.deltaPts} pts)`;
    case 'PROMOTION_STARTED':
      return `Promotion started: ${p.name}`;
    case 'PROMOTION_ENDED':
      return `Promotion ended: ${p.name}`;
    case 'ROOM_BOOKED':
    case 'ROOM_CANCELLED':
      return `${type === 'ROOM_BOOKED' ? 'Large booking' : 'Large cancellation'}: ${money(Number(p.amount))} (${catName(p.category)}, ${p.channel})`;
    default:
      return type;
  }
};

