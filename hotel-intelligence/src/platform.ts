import { AnomalyDetector, type AnomalyConfig } from './anomaly/anomalyDetector';
import { BaselineEngine, type BaselineConfig } from './baseline/baselineEngine';
import { evaluatedMetrics, PICKUP_PREFIX, specFor } from './baseline/metricSpecs';
import { buildBrief, renderBriefMarkdown, type Brief } from './briefing/dailyBrief';
import { ContextEngine } from './context/contextEngine';
import { Copilot, type Answer } from './copilot/copilot';
import { PlainNarrator, type Narrator } from './copilot/narrator';
import { ApprovalWorkflow, DryRunExecutor, type ActionExecutor, type AutomationRule } from './decision/approval';
import { DecisionEngine } from './decision/decisionEngine';
import { deriveDailyMetrics } from './detection/aggregator';
import { ChangeDetector } from './detection/changeDetector';
import { classifyEvent } from './detection/classifier';
import { makeEvent } from './detection/events';
import { AdapterRegistry } from './integration/adapter';
import { HistoricalMemory } from './memory/historicalMemory';
import { AlertManager } from './ranking/alertManager';
import { buildAlert } from './ranking/importance';
import { EventStore } from './store/eventStore';
import { MetricStore } from './store/metricStore';
import { StateStore } from './store/stateStore';
import type { Anomaly, DateKey, DayReport, HotelEvent, HotelProfile, Observation, Role } from './types';
import { dateRange, dayEnd, toDateKey } from './util/time';

export interface PlatformOptions {
  narrator?: Narrator;
  executor?: ActionExecutor;
  automation?: AutomationRule[];
  alertCooldownDays?: number;
  baseline?: Partial<BaselineConfig>;
  anomaly?: Partial<AnomalyConfig>;
}

export interface IngestResult {
  observations: number;
  eventsAppended: number;
  duplicates: number;
}

/**
 * One hotel's intelligence pipeline:
 *
 *   adapters → observations → change detection → event store
 *                                   └─ metric store → baselines → anomalies → context
 *                                        → decisions → importance ranking → alerts / brief / copilot
 *
 * Ingestion is continuous and idempotent; `closeDay` is the analysis step for a business date.
 */
export class HotelIntelligence {
  readonly registry = new AdapterRegistry();
  readonly events = new EventStore();
  readonly metrics = new MetricStore();
  readonly state = new StateStore();
  readonly baseline: BaselineEngine;
  readonly anomalies: AnomalyDetector;
  readonly approvals: ApprovalWorkflow;
  readonly memory: HistoricalMemory;
  readonly copilot: Copilot;

  private detector: ChangeDetector;
  private context: ContextEngine;
  private decisions: DecisionEngine;
  private alertManager: AlertManager;
  private narrator: Narrator;
  private reports = new Map<DateKey, DayReport>();
  private latest: DateKey | null = null;
  private seenAdditive = new Set<string>();

  constructor(
    readonly profile: HotelProfile,
    opts: PlatformOptions = {},
  ) {
    this.narrator = opts.narrator ?? new PlainNarrator();
    this.baseline = new BaselineEngine(this.metrics, profile, opts.baseline);
    this.anomalies = new AnomalyDetector(this.baseline, profile, opts.anomaly);
    this.detector = new ChangeDetector(profile, this.state);
    this.context = new ContextEngine(profile, this.metrics, this.events, this.state, this.baseline);
    this.decisions = new DecisionEngine(profile, this.state);
    this.approvals = new ApprovalWorkflow(opts.executor ?? new DryRunExecutor(), opts.automation ?? []);
    this.alertManager = new AlertManager(opts.alertCooldownDays);
    this.memory = new HistoricalMemory(this.metrics, this.events, this.baseline);
    this.copilot = new Copilot(
      {
        profile,
        metrics: this.metrics,
        events: this.events,
        baseline: this.baseline,
        memory: this.memory,
        asOf: () => this.latest,
        report: (d) => this.reports.get(d),
      },
      this.narrator,
    );
  }

  /* ---------------------------- ingestion ---------------------------- */

  /** Parse a raw payload with a registered adapter and ingest the result. */
  ingest(adapterId: string, raw: unknown): IngestResult {
    return this.ingestObservations(this.registry.get(adapterId).parse(raw, { profile: this.profile }));
  }

  ingestObservations(observations: Observation[]): IngestResult {
    const tz = this.profile.tzOffsetMinutes;
    const sorted = [...observations].sort((a, b) => a.ts - b.ts);
    const touched = new Set<DateKey>();
    let appended = 0;
    let duplicates = 0;

    for (const obs of sorted) {
      if (obs.kind === 'metric') {
        if (obs.mode === 'add') {
          // interval readings: a replayed reading must not be added twice
          const k = `${obs.source}|${obs.metric}|${obs.ts}|${obs.value}`;
          if (this.seenAdditive.has(k)) {
            duplicates++;
            continue;
          }
          this.seenAdditive.add(k);
          this.metrics.add(obs.metric, obs.date, obs.value);
        } else this.metrics.set(obs.metric, obs.date, obs.value);
        touched.add(obs.date);
      } else touched.add(toDateKey(obs.ts, tz));

      for (const e of this.detector.process(obs)) {
        const { significance, reasons } = classifyEvent(e, this.profile);
        if (this.events.append({ ...e, significance, reasons })) appended++;
        else duplicates++;
      }
    }
    for (const d of touched) deriveDailyMetrics(d, this.profile, this.events, this.metrics);
    return { observations: sorted.length, eventsAppended: appended, duplicates };
  }

  /* ----------------------------- analysis ---------------------------- */

  async closeDay(date: DateKey): Promise<DayReport> {
    deriveDailyMetrics(date, this.profile, this.events, this.metrics);

    const evaluations: Anomaly[] = [];
    for (const metric of evaluatedMetrics(this.profile)) {
      const observed = this.metrics.get(metric, date);
      if (observed === undefined) continue;
      const a = this.anomalies.evaluate(metric, date, observed);
      if (a && a.classification !== 'insufficient_baseline') evaluations.push(a);
    }
    const live = evaluations.filter((a) => a.classification === 'actionable' || a.classification === 'watch');
    for (const a of live) this.emitAnomalyEvent(a);

    const situations = this.context.analyze(date, live);
    const recommendations = await this.approvals.submit(this.decisions.recommend(situations));

    const dailyRevenueBaseline = this.baseline.expect('revenue', date)?.expected ?? 0;
    const alerts = situations.map((s) => buildAlert(s, recommendations, { dailyRevenueBaseline }));
    const { surfaced, suppressedNoise, suppressedRepeats } = this.alertManager.filter(alerts, date);

    const report: DayReport = {
      date,
      evaluations,
      situations,
      recommendations,
      alerts,
      surfaced,
      suppressed: { noise: suppressedNoise, repeats: suppressedRepeats },
      notableEvents: this.events.query({ fromDate: date, toDate: date, minSignificance: 'notable' }),
    };
    this.reports.set(date, report);
    this.memory.record(report);
    if (!this.latest || date > this.latest) this.latest = date;
    return report;
  }

  /** Replays a date range in order, building the history that baselines, memory and alert cooldowns depend on. */
  async backfill(from: DateKey, to: DateKey): Promise<void> {
    for (const d of dateRange(from, to)) await this.closeDay(d);
  }

  report(date: DateKey): DayReport | undefined {
    return this.reports.get(date);
  }

  get asOf(): DateKey | null {
    return this.latest;
  }

  /* ----------------------------- outputs ----------------------------- */

  brief(date: DateKey | undefined = this.latest ?? undefined, role?: Role): Brief {
    const report = date ? this.reports.get(date) : undefined;
    if (!report) throw new Error(`No analysis for ${date ?? 'any date'}; call closeDay() first`);
    return buildBrief(report, this.profile, role);
  }

  async briefMarkdown(date?: DateKey, role?: Role): Promise<string> {
    const b = this.brief(date, role);
    const draft = renderBriefMarkdown(b);
    return this.narrator.narrate({ task: 'brief', draft, facts: b });
  }

  ask(question: string): Promise<Answer> {
    return this.copilot.ask(question);
  }

  /* ------------------------------ private ---------------------------- */

  private emitAnomalyEvent(a: Anomaly): void {
    const spec = specFor(a.metric, this.profile);
    if (!spec || spec.alerting === false) return;
    let type = spec.eventType;
    if (a.metric.startsWith(PICKUP_PREFIX)) type = a.direction === 'up' ? 'ROOM_CATEGORY_SELLING_FAST' : 'ROOM_CATEGORY_SELLING_SLOW';
    else if (spec.surface !== 'both' && spec.surface !== a.direction) type = 'METRIC_ANOMALY';
    const significance = a.classification === 'watch' ? 'minor' : Math.abs(a.z) >= 5 ? 'major' : 'notable';
    this.events.append(
      makeEvent({
        hotelId: this.profile.id,
        type,
        ts: dayEnd(a.date, this.profile.tzOffsetMinutes),
        date: a.date,
        source: 'anomaly-engine',
        dedupeKey: `${a.metric}|${a.date}`,
        significance,
        reasons: [`${a.label} ${a.deviationPct >= 0 ? '+' : ''}${a.deviationPct.toFixed(0)}% vs baseline (z=${a.z.toFixed(1)})`],
        payload: {
          metric: a.metric,
          observed: Math.round(a.observed * 10) / 10,
          expected: Math.round(a.expected * 10) / 10,
          deviationPct: Math.round(a.deviationPct * 10) / 10,
          z: Math.round(a.z * 10) / 10,
          direction: a.direction,
        },
      }),
    );
  }
}

export type { HotelEvent };
