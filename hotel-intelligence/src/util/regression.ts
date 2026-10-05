import { median, robustSigma } from './stats';

export interface OlsFit {
  /** coef[0] is the intercept; coef[i+1] pairs with column i of X. */
  coef: number[];
  r2: number;
  /** Robust residual standard deviation. */
  sigma: number;
  n: number;
}

/** Solves A x = b by Gaussian elimination with partial pivoting. Returns null if singular. */
const solve = (A: number[][], b: number[]): number[] | null => {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
};

const fitOnce = (X: number[][], y: number[]): { coef: number[]; resid: number[] } | null => {
  const p = X[0].length + 1;
  const rows = X.map((r) => [1, ...r]);
  const XtX = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const Xty = new Array<number>(p).fill(0);
  rows.forEach((r, i) => {
    for (let a = 0; a < p; a++) {
      Xty[a] += r[a] * y[i];
      for (let b = 0; b < p; b++) XtX[a][b] += r[a] * r[b];
    }
  });
  for (let a = 1; a < p; a++) XtX[a][a] += 1e-9 * XtX[a][a]; // tiny ridge for conditioning
  const coef = solve(XtX, Xty);
  if (!coef) return null;
  const resid = rows.map((r, i) => y[i] - r.reduce((s, v, k) => s + v * coef[k], 0));
  return { coef, resid };
};

/**
 * Ordinary least squares with iterative outlier trimming, so past anomalies in the history do not
 * contaminate "what is normal". Returns null when there is too little data or the system is singular.
 */
export const robustOls = (X: number[][], y: number[], trimK = 3, rounds = 3): OlsFit | null => {
  const p = X.length ? X[0].length + 1 : 0;
  if (!X.length || X.length < p * 5) return null;
  let keep = y.map((_, i) => i);
  let fit = fitOnce(X, y);
  if (!fit) return null;
  for (let r = 0; r < rounds; r++) {
    const s = robustSigma(fit.resid) || 1e-9;
    const m = median(fit.resid);
    const kept = fit.resid.map((e, i) => (Math.abs(e - m) <= trimK * s ? i : -1)).filter((i) => i >= 0);
    if (kept.length === keep.length || kept.length < p * 5) break;
    keep = kept; // residuals are always over the full sample, so these are full-sample indices
    const refit = fitOnce(keep.map((i) => X[i]), keep.map((i) => y[i]));
    if (!refit) break;
    // residuals on the full sample from the refit coefficients
    fit = {
      coef: refit.coef,
      resid: y.map((yi, i) => yi - [1, ...X[i]].reduce((s2, v, k) => s2 + v * refit.coef[k], 0)),
    };
  }
  const kept = keep.map((i) => fit!.resid[i]);
  const yk = keep.map((i) => y[i]);
  const ym = yk.reduce((a, b) => a + b, 0) / yk.length;
  const ssTot = yk.reduce((a, v) => a + (v - ym) ** 2, 0);
  const ssRes = kept.reduce((a, e) => a + e * e, 0);
  return {
    coef: fit.coef,
    r2: ssTot > 0 ? 1 - ssRes / ssTot : 0,
    sigma: Math.sqrt(ssRes / Math.max(1, kept.length - p)),
    n: keep.length,
  };
};

export const predict = (fit: OlsFit, x: number[]): number =>
  fit.coef[0] + x.reduce((s, v, i) => s + v * fit.coef[i + 1], 0);
