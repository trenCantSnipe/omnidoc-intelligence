import type { DateKey, Expectation, HotelProfile } from '../types';
import type { MetricStore } from '../store/metricStore';
import { predict, robustOls } from '../util/regression';
import { median, robustSigma, weightedMedian, weightedRobustSigma } from '../util/stats';
import { dayOfWeek, daysBetween } from '../util/time';
import { specFor } from './metricSpecs';

export interface BaselineConfig {
  lookbackDays: number;
  /** Recent weeks count more; seasonality drifts. */
  halfLifeDays: number;
  minRegressionPoints: number;
  minRegressionR2: number;
}

const DEFAULTS: BaselineConfig = { lookbackDays: 120, halfLifeDays: 35, minRegressionPoints: 21, minRegressionR2: 0.3 };

/**
 * Learns "normal for this hotel" for each metric on each date.
 *
 * Two models compete and the tighter one wins:
 *  - seasonal: recency-weighted median of the same weekday (robust to past anomalies), with
 *    variance shrunk toward the hotel's pooled day-to-day variability so a handful of samples
 *    cannot produce a falsely tiny (or huge) sigma;
 *  - regression: metric explained by same-day covariates (electricity ~ rooms sold), fitted with
 *    outlier trimming. This is what makes "electricity is 43% up *despite similar occupancy*"
 *    answerable: the expectation already accounts for occupancy.
 */
export class BaselineEngine {
  private cfg: BaselineConfig;

  constructor(
    private metrics: MetricStore,
    private profile: HotelProfile,
    cfg: Partial<BaselineConfig> = {},
  ) {
    this.cfg = { ...DEFAULTS, ...cfg };
  }

  /** Expectation for `metric` on `date`, learned only from strictly earlier days. Null if no history at all. */
  expect(metric: string, date: DateKey, opts: { seasonalOnly?: boolean } = {}): Expectation | null {
    const spec = specFor(metric, this.profile);
    const log = !!spec?.logScale;
    const hist = this.metrics
      .series(metric)
      .filter(([d, v]) => d < date && daysBetween(d, date) <= this.cfg.lookbackDays && (!log || v > 0))
      .map(([d, v]): [DateKey, number] => [d, log ? Math.log(v) : v]);
    if (hist.length < 3) return null;

    const notes: string[] = [];
    const special = this.profile.calendar[date];
    const dow = dayOfWeek(date);
    const w = (d: DateKey): number => 0.5 ** (daysBetween(d, date) / this.cfg.halfLifeDays);

    /* ---- seasonal model ---- */
    let pool = hist.filter(([d]) => dayOfWeek(d) === dow);
    let method: Expectation['method'] = 'seasonal';
    if (pool.length < 4) {
      pool = hist;
      notes.push('few same-weekday samples; using all days');
    }
    if (special) {
      const specialSamples = hist.filter(([d]) => this.profile.calendar[d]);
      if (specialSamples.length >= 3) {
        pool = specialSamples;
        method = 'seasonal-special';
        notes.push(`baseline built from past special days (${special})`);
      } else notes.push(`${special}: no comparable past special days, uncertainty widened`);
    }
    const vals = pool.map((p) => p[1]);
    const wts = pool.map((p) => w(p[0]));
    const seasonalExpected = weightedMedian(vals, wts);
    const sigmaDow = weightedRobustSigma(vals, wts);

    // Pooled relative variability across the whole history, measured against each weekday's median.
    const dowMedian = new Map<number, number>();
    for (let k = 0; k < 7; k++) {
      const v = hist.filter(([d]) => dayOfWeek(d) === k).map((p) => p[1]);
      if (v.length) dowMedian.set(k, median(v));
    }
    const rel = hist
      .map(([d, v]) => {
        const m = dowMedian.get(dayOfWeek(d))!;
        return log ? v - m : Math.abs(m) > 1e-9 ? (v - m) / Math.abs(m) : 0;
      })
      .filter(Number.isFinite);
    const pooledSigma = robustSigma(rel) * (log ? 1 : Math.abs(seasonalExpected));
    let sigmaSeasonal = pool === hist || pool.length < 6 ? pooledSigma || sigmaDow : Math.sqrt(0.5 * sigmaDow ** 2 + 0.5 * pooledSigma ** 2);
    if (special && method === 'seasonal') sigmaSeasonal *= 1.3;

    // Variance floors keep near-constant series and low counts from producing absurd z-scores.
    // They are applied to the *chosen* model only: floors scale with the expected value, so
    // applying them before comparing would penalise whichever model predicts higher.
    const floored = (sig: number, exp: number): number => {
      let f = sig;
      if (spec?.sigmaFloorPct) f = Math.max(f, spec.sigmaFloorPct * Math.abs(exp));
      if (spec?.sigmaFloorAbs) f = Math.max(f, spec.sigmaFloorAbs);
      if (spec?.poisson) f = Math.max(f, Math.sqrt(Math.max(exp, 1)));
      return Math.max(f, 1e-6);
    };

    let expected = seasonalExpected;
    let sigma = sigmaSeasonal;
    let drivers: Expectation['drivers'] = [];
    let confidence = Math.min(1, 0.35 + hist.length / 90);

    /* ---- regression model ---- */
    if (spec?.covariates.length && !opts.seasonalOnly) {
      const covNow = spec.covariates.map((c) => this.metrics.get(c, date));
      if (covNow.every((v) => v !== undefined)) {
        const X: number[][] = [];
        const y: number[] = [];
        for (const [d, v] of hist) {
          const row = spec.covariates.map((c) => this.metrics.get(c, d));
          if (row.every((r) => r !== undefined)) {
            X.push(row as number[]);
            y.push(v);
          }
        }
        if (X.length >= this.cfg.minRegressionPoints) {
          const fit = robustOls(X, y);
          if (fit && fit.r2 >= this.cfg.minRegressionR2) {
            const x = covNow as number[];
            // Warn when the day sits outside the range the model was trained on.
            const outside = spec.covariates.some((_, i) => {
              const col = X.map((r) => r[i]);
              const lo = Math.min(...col);
              const hi = Math.max(...col);
              return x[i] < lo - 0.1 * (hi - lo) || x[i] > hi + 0.1 * (hi - lo);
            });
            // A same-day driver (rooms sold) is strictly more informative than the weekday alone,
            // so the regression wins unless its residual noise is larger.
            if (fit.sigma <= sigmaSeasonal) {
              expected = predict(fit, x);
              sigma = outside ? fit.sigma * 1.5 : fit.sigma;
              if (outside) notes.push('covariates outside the usual range; uncertainty widened');
              method = 'regression';
              drivers = spec.covariates.map((name, i) => ({ name, coef: fit.coef[i + 1] }));
              confidence *= 0.6 + 0.4 * fit.r2;
            }
          }
        }
      }
    }

    sigma = floored(sigma, log ? 1 : expected); // on the log scale a percentage floor is already relative
    const back = (v: number): number => (log ? Math.exp(v) : v);

    return {
      expected: back(expected),
      sigma,
      scale: log ? 'log' : 'linear',
      // every metric we model is non-negative; a negative "normal range" is meaningless
      lower: Math.max(0, back(expected - 2 * sigma)),
      upper: back(expected + 2 * sigma),
      method,
      n: hist.length,
      confidence: Math.max(0.1, Math.min(1, confidence)),
      drivers,
      notes,
    };
  }
}
