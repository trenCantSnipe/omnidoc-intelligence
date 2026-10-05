export const money = (n: number): string => `₹${Math.round(n).toLocaleString('en-IN')}`;

export const pct = (n: number, digits = 0): string => `${n.toFixed(digits)}%`;

export const signedPct = (n: number, digits = 0): string => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(digits)}%`;

export const count = (n: number): string => Math.round(n).toLocaleString('en-IN');

export const mult = (n: number): string => `${n.toFixed(1)}×`;

export const formatMetric = (unit: string, v: number): string => {
  if (unit === '₹') return money(v);
  if (unit === '%') return pct(v, 1);
  return `${count(v)} ${unit}`;
};
