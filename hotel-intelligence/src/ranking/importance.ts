import type { Alert, Recommendation, Situation, Tier } from '../types';
import { clamp, fnv1a, round } from '../util/stats';

export interface RankingContext {
  /** Typical daily revenue; money impacts are judged relative to it. */
  dailyRevenueBaseline: number;
}

/**
 * Standing conditions (a rate-parity gap, an over-market price) are true every day until someone
 * fixes them; telling people daily is nagging. One-off events (a spike) may recur sooner.
 */
const COOLDOWN_DAYS: Partial<Record<Situation['kind'], number>> = { rate_parity_gap: 7, price_undercut: 7, market_move: 3 };

const URGENCY: Record<Situation['urgency'], number> = { now: 1, today: 0.7, this_week: 0.4, fyi: 0.15 };

export const tierFor = (score: number): Tier => (score >= 0.75 ? 'critical' : score >= 0.45 ? 'important' : score >= 0.22 ? 'informational' : 'noise');

/**
 * Importance = business impact first. Money at stake relative to a normal day's revenue carries
 * the most weight; statistical severity, confidence and urgency refine it. Impact saturates at 8% of
 * a day's revenue so one huge number cannot hide everything else.
 */
export const scoreSituation = (s: Situation, ctx: RankingContext): number => {
  const impactShare = s.impactAmount && ctx.dailyRevenueBaseline > 0 ? s.impactAmount / ctx.dailyRevenueBaseline : 0;
  const impact = clamp(impactShare / 0.08, 0, 1);
  const hasImpact = s.impactAmount !== undefined && s.impactAmount > 0;
  // When money cannot be estimated, lean on severity so non-monetary issues are not buried.
  const raw = hasImpact
    ? 0.5 * impact + 0.2 * s.severity + 0.15 * s.confidence + 0.15 * URGENCY[s.urgency]
    : 0.5 * s.severity + 0.3 * s.confidence + 0.2 * URGENCY[s.urgency];
  // Urgency caps the tier: "review today" needs something that must be acted on today. Items for
  // the weekly review stay informational, and a pure FYI (e.g. a revenue beat) is barely above noise.
  const cap = s.urgency === 'fyi' ? 0.3 : s.urgency === 'this_week' ? 0.44 : 1;
  return clamp(Math.min(raw, cap), 0, 1);
};

export const buildAlert = (s: Situation, recs: Recommendation[], ctx: RankingContext): Alert => {
  const score = scoreSituation(s, ctx);
  return {
    id: `alert_${fnv1a(s.id)}`,
    hotelId: s.hotelId,
    date: s.date,
    tier: tierFor(score),
    score: round(score, 3),
    title: s.title,
    body: s.summary,
    domains: s.domains,
    situationId: s.id,
    recommendationIds: recs.filter((r) => r.situationId === s.id).map((r) => r.id),
    // identity of the underlying issue, stable across days so repeats can be throttled
    dedupeKey: `${s.kind}|${s.category ?? ''}|${s.metric ?? ''}`,
    cooldownDays: COOLDOWN_DAYS[s.kind] ?? 2,
  };
};
