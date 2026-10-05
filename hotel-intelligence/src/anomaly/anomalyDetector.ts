import { specFor } from '../baseline/metricSpecs';
import type { BaselineEngine } from '../baseline/baselineEngine';
import type { Anomaly, AnomalyClass, DateKey, HotelProfile } from '../types';
import { fnv1a } from '../util/stats';

export interface AnomalyConfig {
  /** |z| at or above which a deviation is statistically significant. */
  zActionable: number;
  /** |z| at or above which a deviation is worth watching. */
  zWatch: number;
}

const DEFAULTS: AnomalyConfig = { zActionable: 3, zWatch: 2 };

/**
 * Separates normal variation from actionable anomalies. A deviation is actionable only if it is
 * BOTH statistically unusual for this hotel (z-score vs. its own baseline) AND operationally big
 * enough to matter (relative/absolute effect size from the metric spec). That double gate is what
 * keeps the notification stream clean: a 30% swing in a metric that normally moves 40% is noise;
 * a 6% swing in a metric that never moves is also not worth a human's attention.
 */
export class AnomalyDetector {
  private cfg: AnomalyConfig;

  constructor(
    private baseline: BaselineEngine,
    private profile: HotelProfile,
    cfg: Partial<AnomalyConfig> = {},
  ) {
    this.cfg = { ...DEFAULTS, ...cfg };
  }

  evaluate(metric: string, date: DateKey, observed: number): Anomaly | null {
    const spec = specFor(metric, this.profile);
    if (!spec) return null;
    const exp = this.baseline.expect(metric, date);
    if (!exp) return null;

    const z = exp.scale === 'log' ? (Math.log(Math.max(observed, 1e-9)) - Math.log(exp.expected)) / exp.sigma : (observed - exp.expected) / exp.sigma;
    const absDev = observed - exp.expected;
    const deviationPct = Math.abs(exp.expected) > 1e-9 ? (absDev / Math.abs(exp.expected)) * 100 : 0;
    const direction = absDev >= 0 ? 'up' : 'down';

    const opSignificant =
      Math.abs(deviationPct) / 100 >= spec.minRelEffect && (spec.minAbsEffect === undefined || Math.abs(absDev) >= spec.minAbsEffect);
    const opHalf = Math.abs(deviationPct) / 100 >= spec.minRelEffect / 2;
    const sideOk = spec.surface === 'both' || spec.surface === direction;

    let classification: AnomalyClass;
    if (exp.n < spec.minHistory) classification = 'insufficient_baseline';
    else if (Math.abs(z) >= this.cfg.zActionable && opSignificant && sideOk && spec.alerting !== false) classification = 'actionable';
    else if (Math.abs(z) >= this.cfg.zWatch && opHalf) classification = 'watch';
    else classification = 'normal';

    const favorable = spec.goodDirection === null ? null : spec.goodDirection === direction;

    return {
      id: `anom_${fnv1a(`${this.profile.id}|${metric}|${date}`)}`,
      hotelId: this.profile.id,
      metric,
      label: spec.label,
      unit: spec.unit,
      date,
      observed,
      expected: exp.expected,
      lower: exp.lower,
      upper: exp.upper,
      z,
      deviationPct,
      direction,
      classification,
      favorable,
      method: exp.method,
      confidence: exp.confidence,
      drivers: exp.drivers,
      notes: exp.notes,
      domains: spec.domains,
    };
  }
}
