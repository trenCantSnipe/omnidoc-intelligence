import type { StateStore } from '../store/stateStore';
import type { HotelProfile, Recommendation, Situation } from '../types';
import { fnv1a, round } from '../util/stats';
import { money, pct } from '../util/format';
import { MAX_SINGLE_MOVE_PCT, roundRate } from './pricing';

/**
 * Turns situations into concrete recommendations. Every recommendation carries its rationale,
 * the guardrails that were applied, and a risk rating. Nothing here changes a system: execution
 * is a separate, permissioned step (see approval.ts).
 */
export class DecisionEngine {
  constructor(
    private profile: HotelProfile,
    private state: StateStore,
  ) {}

  recommend(situations: Situation[]): Recommendation[] {
    const out: Recommendation[] = [];
    for (const s of situations) {
      const r = this.forSituation(s);
      if (r) out.push(r);
    }
    return out;
  }

  private base(s: Situation, type: Recommendation['type'], suffix: string): Pick<Recommendation, 'id' | 'hotelId' | 'situationId' | 'createdForDate' | 'type' | 'requiresApproval' | 'status' | 'domains'> {
    return {
      id: `rec_${fnv1a(`${s.id}|${type}|${suffix}`)}`,
      hotelId: this.profile.id,
      situationId: s.id,
      createdForDate: s.date,
      type,
      requiresApproval: true,
      status: 'proposed',
      domains: s.domains,
    };
  }

  private forSituation(s: Situation): Recommendation | null {
    const cat = this.profile.categories.find((c) => c.id === s.category);
    switch (s.kind) {
      case 'demand_surge': {
        if (!cat) return null;
        const lowPct = Number(s.facts.suggestedLowPct);
        const highPct = Number(s.facts.suggestedHighPct);
        const centerPct = (lowPct + highPct) / 2;
        const current = Number(s.facts.currentRate);
        const guardrails: string[] = [`single move capped at ${MAX_SINGLE_MOVE_PCT}%`];
        let target = roundRate(current * (1 + centerPct / 100));
        if (target > cat.maxRate) {
          target = cat.maxRate;
          guardrails.push(`capped at ${cat.name} ceiling ${money(cat.maxRate)}`);
        }
        const effectivePct = round(((target - current) / current) * 100, 1);
        if (effectivePct <= 0) return null; // already at the ceiling: nothing to recommend
        return {
          ...this.base(s, 'ADJUST_PRICE', cat.id),
          title: `Raise ${cat.name} rates ${lowPct}–${highPct}%`,
          rationale: `${cat.name} rooms are selling ${s.facts.pickupMultiple}× faster than this hotel's normal pace${Number(s.facts.remainingPct) >= 0 ? ` with only ${s.facts.remainingPct}% of next-week inventory left` : ''}${Number(s.facts.competitorsUp) ? ` and ${s.facts.competitorsUp} competitor(s) already moved up (avg ${s.facts.competitorAvgUpPct}%)` : ''}. Recommended action: increase ${cat.name} pricing by ${lowPct}–${highPct}%.`,
          params: { category: cat.id, currentRate: current, targetRate: target, changePct: effectivePct, lowPct, highPct },
          expectedImpact: s.impactAmount ? { amount: s.impactAmount, basis: s.impactBasis ?? '' } : undefined,
          risk: effectivePct > 10 ? 'medium' : 'low',
          confidence: s.confidence,
          guardrails: [...guardrails, 'review again in 24h: roll back if pickup normalises'],
        };
      }

      case 'demand_softness': {
        if (!cat) return null;
        return {
          ...this.base(s, 'LAUNCH_PROMOTION', cat.id),
          title: `Stimulate ${cat.name} demand (targeted offer, not a blanket cut)`,
          rationale: `${s.summary} Prefer a time-boxed direct-channel offer or package over a rate cut: it protects ADR and the OTA parity position.`,
          params: { category: cat.id, suggestedDiscountPct: 5, channel: 'direct', durationDays: 3 },
          expectedImpact: s.impactAmount ? { amount: s.impactAmount, basis: s.impactBasis ?? '' } : undefined,
          risk: 'low',
          confidence: s.confidence,
          guardrails: [`never below ${cat ? money(cat.minRate) : 'the floor rate'}`, 'direct channel only'],
        };
      }

      case 'price_undercut': {
        if (!cat) return null;
        const own = Number(s.facts.ownDirect);
        const lowest = Number(s.facts.lowestMarket);
        // Close part of the gap, never chase the lowest price; stay within 4% above it.
        const target = Math.max(cat.minRate, roundRate(lowest * 1.04));
        if (target >= own) return null;
        return {
          ...this.base(s, 'ADJUST_PRICE', cat.id),
          title: `Review ${cat.name} direct rate (currently ${s.facts.gapPct}% above lowest comparable)`,
          rationale: `${s.summary} If ${cat.name} is not deliberately positioned as a premium product, consider moving toward ${money(target)}. Check demand first: if pace is healthy, holding rate is the better call.`,
          params: { category: cat.id, currentRate: own, targetRate: target, changePct: round(((target - own) / own) * 100, 1) },
          risk: 'medium',
          confidence: s.confidence * 0.8,
          guardrails: [`floor ${money(cat.minRate)}`, 'do not match below-market rates blindly'],
        };
      }

      case 'rate_parity_gap': {
        if (!cat) return null;
        const ota = Number(s.facts.ota);
        return {
          ...this.base(s, 'FIX_RATE_PARITY', cat.id),
          title: `Align ${cat.name} direct rate with OTA (${money(ota)})`,
          rationale: `${s.summary} Make the direct channel at least as cheap as OTAs (or add direct-only value) to recover commission-free bookings.`,
          params: { category: cat.id, directRate: Number(s.facts.direct), otaRate: ota, targetRate: ota },
          risk: 'low',
          confidence: s.confidence,
          guardrails: ['verify channel-manager parity rules before pushing'],
        };
      }

      case 'energy_inefficiency':
        return {
          ...this.base(s, 'INVESTIGATE', 'energy'),
          title: 'Investigate unexplained electricity consumption',
          rationale: `${s.summary} Check for HVAC left running in vacant rooms, common-area/pump schedules, new equipment, or a faulty/mis-scaled meter.`,
          params: { area: 'energy', excessKwh: Number(s.facts.excessKwh) },
          expectedImpact: s.impactAmount ? { amount: s.impactAmount, basis: s.impactBasis ?? '' } : undefined,
          risk: 'low',
          confidence: s.confidence,
          guardrails: [],
        };

      case 'cancellation_spike':
        return {
          ...this.base(s, 'INVESTIGATE', 'cancellations'),
          title: 'Investigate the cancellation spike',
          rationale: `${s.summary} Look for a common cause (a competitor/OTA promotion, a rate or policy change, an event cancellation) before changing cancellation policies.`,
          params: { area: 'cancellations', topChannel: String(s.facts.topChannel) },
          expectedImpact: s.impactAmount ? { amount: s.impactAmount, basis: s.impactBasis ?? '' } : undefined,
          risk: 'low',
          confidence: s.confidence,
          guardrails: [],
        };

      case 'revenue_deviation':
        if (s.polarity !== 'problem') return null;
        return {
          ...this.base(s, 'INVESTIGATE', 'revenue'),
          title: 'Review the revenue shortfall',
          rationale: s.summary,
          params: { area: 'revenue' },
          expectedImpact: s.impactAmount ? { amount: s.impactAmount, basis: s.impactBasis ?? '' } : undefined,
          risk: 'low',
          confidence: s.confidence,
          guardrails: [],
        };

      case 'cost_anomaly':
        if (s.polarity !== 'problem') return null;
        return {
          ...this.base(s, 'INVESTIGATE', s.metric ?? 'cost'),
          title: `Review: ${s.title.toLowerCase()}`,
          rationale: s.summary,
          params: { area: s.metric ?? 'cost' },
          expectedImpact: s.impactAmount ? { amount: s.impactAmount, basis: s.impactBasis ?? '' } : undefined,
          risk: 'low',
          confidence: s.confidence,
          guardrails: [],
        };

      default:
        return null;
    }
  }
}

/** Used when a recommendation is shown: "from ₹6,500 to ₹7,150 (+10%)". */
export const describePriceAction = (r: Recommendation): string =>
  r.type === 'ADJUST_PRICE' || r.type === 'FIX_RATE_PARITY'
    ? `from ${money(Number(r.params.currentRate ?? r.params.directRate))} to ${money(Number(r.params.targetRate))}${r.params.changePct !== undefined ? ` (${Number(r.params.changePct) >= 0 ? '+' : ''}${pct(Number(r.params.changePct), 1)})` : ''}`
    : '';

