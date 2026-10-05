import { describe, expect, it } from 'vitest';
import { parseCsv } from '../src/util/csv';
import { robustOls, predict } from '../src/util/regression';
import { robustSigma, weightedMedian } from '../src/util/stats';
import { addDays, dayOfWeek, parseTimestamp, toDateKey } from '../src/util/time';

describe('csv', () => {
  it('handles quotes, escaped quotes, CRLF and BOM', () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\r\n1,2\r\n');
    expect(rows).toEqual([{ a: 'x, y', b: 'he said "hi"' }, { a: '1', b: '2' }]);
  });
});

describe('time', () => {
  it('interprets naive timestamps as hotel-local time', () => {
    // 2026-10-04 00:30 IST is still 2026-10-03 in UTC
    const ts = parseTimestamp('2026-10-04 00:30', 330);
    expect(new Date(ts).toISOString()).toBe('2026-10-03T19:00:00.000Z');
    expect(toDateKey(ts, 330)).toBe('2026-10-04');
  });
  it('respects explicit offsets and date arithmetic', () => {
    expect(parseTimestamp('2026-10-04T10:00:00Z', 330)).toBe(Date.parse('2026-10-04T10:00:00Z'));
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(dayOfWeek('2026-10-04')).toBe(0); // Sunday
  });
  it('rejects garbage rather than guessing', () => {
    expect(() => parseTimestamp('yesterday-ish', 330)).toThrow();
  });
});

describe('stats', () => {
  it('robust sigma ignores outliers that would wreck a standard deviation', () => {
    const clean = Array.from({ length: 50 }, (_, i) => 100 + (i % 5) - 2);
    const dirty = [...clean, 10_000, -5_000];
    expect(robustSigma(dirty)).toBeCloseTo(robustSigma(clean), 0);
  });
  it('weighted median follows the weights', () => {
    expect(weightedMedian([1, 2, 3], [1, 1, 10])).toBe(3);
  });
});

describe('robust regression', () => {
  it('recovers the true relationship despite contaminated history', () => {
    const X: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < 100; i++) {
      const x = 30 + (i % 50);
      X.push([x]);
      y.push(1500 + 38 * x + ((i * 7) % 11) - 5);
    }
    // past incidents: a few days with wildly high consumption
    for (const i of [3, 17, 44, 71]) y[i] += 2500;
    const fit = robustOls(X, y)!;
    expect(fit.coef[1]).toBeCloseTo(38, 0);
    expect(fit.coef[0]).toBeGreaterThan(1450);
    expect(fit.coef[0]).toBeLessThan(1550);
    expect(fit.r2).toBeGreaterThan(0.95);
    expect(predict(fit, [60])).toBeCloseTo(1500 + 38 * 60, -1);
  });
  it('declines to fit with too little data', () => {
    expect(robustOls([[1], [2], [3]], [1, 2, 3])).toBeNull();
  });
});
