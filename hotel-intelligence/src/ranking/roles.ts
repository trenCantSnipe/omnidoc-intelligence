import type { Alert, Delivery, Domain, Role, RoutedAlert, Tier } from '../types';

/** How much each role cares about each domain (0..1). */
export const ROLE_INTEREST: Record<Role, Record<Domain, number>> = {
  general_manager: { revenue: 1, demand: 1, pricing: 0.8, market: 0.5, cancellations: 0.7, operations: 0.7, finance: 0.6 },
  revenue_manager: { revenue: 0.8, demand: 1, pricing: 1, market: 1, cancellations: 0.7, operations: 0, finance: 0.2 },
  finance: { revenue: 1, demand: 0.2, pricing: 0.3, market: 0, cancellations: 0.5, operations: 0.4, finance: 1 },
  operations: { revenue: 0.1, demand: 0.3, pricing: 0, market: 0, cancellations: 0, operations: 1, finance: 0.2 },
};

export const ROLE_LABELS: Record<Role, string> = {
  general_manager: 'General Manager',
  revenue_manager: 'Revenue Manager',
  finance: 'Finance',
  operations: 'Operations',
};

const TIER_FACTOR: Record<Tier, number> = { critical: 1, important: 0.65, informational: 0.35, noise: 0 };

/**
 * Role-aware delivery. effective = domain interest × tier factor:
 *  ≥ 0.70 → push (only critical + highly relevant can reach this)
 *  ≥ 0.50 → inbox (review today)      ≥ 0.20 → daily brief only      otherwise → not shown to this role
 * So a GM gets a critical electricity anomaly pushed (1 × .7) but an important one only in the brief
 * (.65 × .7 = .46); Operations never sees pricing noise; Finance sees revenue and cost deviations.
 */
export const routeAlert = (alert: Alert): RoutedAlert[] => {
  const out: RoutedAlert[] = [];
  for (const role of Object.keys(ROLE_INTEREST) as Role[]) {
    const interest = Math.max(...alert.domains.map((d) => ROLE_INTEREST[role][d] ?? 0));
    const effective = interest * TIER_FACTOR[alert.tier];
    const delivery: Delivery | null = effective >= 0.7 ? 'push' : effective >= 0.5 ? 'inbox' : effective >= 0.2 ? 'daily_brief' : null;
    if (delivery) out.push({ alert, role, delivery });
  }
  return out;
};

export const alertsForRole = (alerts: Alert[], role: Role): RoutedAlert[] =>
  alerts.flatMap(routeAlert).filter((r) => r.role === role).sort((a, b) => b.alert.score - a.alert.score);
