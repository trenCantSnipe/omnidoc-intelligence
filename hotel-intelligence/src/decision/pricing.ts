import { clamp } from '../util/stats';

export interface PriceMoveInput {
  /** Observed ÷ expected booking pace for the category. */
  pickupMultiple: number;
  /** Share of forward inventory still unsold, 0..1. Undefined when unknown. */
  remainingShare?: number;
  /** Average % increase across competitors that moved up (0 when none). */
  competitorAvgUpPct: number;
}

export interface PriceMove {
  centerPct: number;
  lowPct: number;
  highPct: number;
}

/** Hard ceiling on a single automated/recommended move; larger jumps need a human to design them. */
export const MAX_SINGLE_MOVE_PCT = 15;

/**
 * Transparent pricing heuristic: faster pickup, scarcer inventory and rising competitor rates each
 * justify a larger increase. Deliberately simple and explainable; a learned elasticity model can
 * replace this behind the same signature once the hotel has enough recorded action outcomes.
 */
export const suggestPriceMove = (i: PriceMoveInput): PriceMove => {
  const pace = Math.min(6, 2 + 1.5 * Math.max(0, i.pickupMultiple - 1));
  const scarcity = i.remainingShare === undefined ? 0 : i.remainingShare <= 0.2 ? 2 : i.remainingShare <= 0.3 ? 1 : 0;
  const market = Math.min(2, 0.25 * Math.max(0, i.competitorAvgUpPct));
  const centerPct = clamp(pace + scarcity + market, 3, MAX_SINGLE_MOVE_PCT - 2);
  return {
    centerPct,
    lowPct: Math.max(2, Math.round(centerPct - 2)),
    highPct: Math.min(MAX_SINGLE_MOVE_PCT, Math.round(centerPct + 2)),
  };
};

/** Rounds to the nearest ₹50, the usual rate-card granularity. */
export const roundRate = (price: number): number => Math.round(price / 50) * 50;
