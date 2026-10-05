export const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

export const mean = (xs: number[]): number => (xs.length ? sum(xs) / xs.length : NaN);

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

export const round = (x: number, digits = 0): number => {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
};

export const quantile = (xs: number[], q: number): number => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
};

export const median = (xs: number[]): number => quantile(xs, 0.5);

/** Median absolute deviation scaled to be a consistent estimator of the standard deviation. */
export const robustSigma = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const m = median(xs);
  return 1.4826 * median(xs.map((x) => Math.abs(x - m)));
};

export const weightedMedian = (values: number[], weights: number[]): number => {
  if (!values.length) return NaN;
  const pairs = values.map((v, i) => [v, weights[i]] as const).sort((a, b) => a[0] - b[0]);
  const total = sum(pairs.map((p) => p[1]));
  let acc = 0;
  for (const [v, w] of pairs) {
    acc += w;
    if (acc >= total / 2) return v;
  }
  return pairs[pairs.length - 1][0];
};

export const weightedRobustSigma = (values: number[], weights: number[]): number => {
  if (values.length < 2) return 0;
  const m = weightedMedian(values, weights);
  return 1.4826 * weightedMedian(values.map((v) => Math.abs(v - m)), weights);
};

export const pctChange = (from: number, to: number): number =>
  from === 0 ? (to === 0 ? 0 : Infinity) : ((to - from) / Math.abs(from)) * 100;

/** Stable 32-bit FNV-1a hash rendered in hex; used for deterministic event ids. */
export const fnv1a = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
};
