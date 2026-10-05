import type { Alert, DateKey, DayReport, HotelProfile, Recommendation, Role, Situation, Tier } from '../types';
import { money, pct, signedPct } from '../util/format';
import { round } from '../util/stats';
import { dowName } from '../util/time';
import { specFor } from '../baseline/metricSpecs';
import { describePriceAction } from '../decision/decisionEngine';
import { alertsForRole, ROLE_LABELS } from '../ranking/roles';

export interface BriefItem {
  alertId: string;
  tier: Tier;
  score: number;
  title: string;
  text: string;
}

export interface BriefSection {
  title: string;
  items: BriefItem[];
}

export interface Brief {
  hotel: string;
  date: DateKey;
  audience: string;
  headline: string;
  kpis: string[];
  sections: BriefSection[];
  actions: { n: number; text: string; recommendationId: string }[];
  watching: string[];
  footer: string;
}

const sectionFor = (s: Situation): string => {
  switch (s.kind) {
    case 'revenue_deviation':
      return 'Revenue';
    case 'demand_surge':
    case 'price_undercut':
    case 'rate_parity_gap':
      return 'Pricing Opportunity';
    case 'demand_softness':
      return 'Demand';
    case 'market_move':
      return 'Market';
    case 'cancellation_spike':
      return 'Cancellations';
    case 'energy_inefficiency':
      return 'Operational Alert';
    case 'cost_anomaly':
      return s.domains.includes('finance') && !s.domains.includes('operations') ? 'Costs' : 'Operational Alert';
  }
};

/**
 * Builds the morning brief from what the platform concluded, ordered by business impact (not by
 * time or by system). The structure is deterministic and every number is traceable; an optional
 * narrator may rephrase it, but never changes the facts.
 */
export const buildBrief = (report: DayReport, profile: HotelProfile, role?: Role): Brief => {
  const byId = new Map(report.situations.map((s) => [s.id, s]));
  const recById = new Map(report.recommendations.map((r) => [r.id, r]));

  let alerts: Alert[] = report.surfaced;
  if (role) {
    const routed = new Set(alertsForRole(report.surfaced, role).map((r) => r.alert.id));
    alerts = alerts.filter((a) => routed.has(a.id));
  }

  /* --- KPI lines: always shown, normal or not --- */
  const ev = (m: string) => report.evaluations.find((e) => e.metric === m);
  const kpis: string[] = [];
  const rev = ev('revenue');
  if (rev)
    kpis.push(
      `Revenue ${money(rev.observed)}, ${Math.abs(rev.deviationPct) < 3 ? 'in line with' : `${signedPct(rev.deviationPct, 0)} vs`} the ${money(rev.expected)} expected for a ${dowName(report.date)}`,
    );
  const occ = ev('occupancy_pct');
  if (occ) kpis.push(`Occupancy ${pct(occ.observed, 0)} (typical ${dowName(report.date)}: ${pct(occ.expected, 0)})`);
  const adr = ev('adr');
  if (adr) kpis.push(`ADR ${money(adr.observed)} (expected ${money(adr.expected)})`);
  const canc = ev('cancellation_rate');
  if (canc) kpis.push(`Cancellation rate ${pct(canc.observed, 1)} (typical ${pct(canc.expected, 1)})`);

  /* --- sections ordered by their most important item --- */
  const sections = new Map<string, BriefSection>();
  const include = alerts.filter((a) => a.tier !== 'noise');
  for (const a of include) {
    const s = byId.get(a.situationId);
    if (!s) continue;
    const title = sectionFor(s);
    const sec = sections.get(title) ?? { title, items: [] };
    sec.items.push({ alertId: a.id, tier: a.tier, score: a.score, title: a.title, text: a.body });
    sections.set(title, sec);
  }
  const ordered = [...sections.values()]
    .map((sec) => ({ ...sec, items: sec.items.sort((x, y) => y.score - x.score) }))
    .sort((x, y) => y.items[0].score - x.items[0].score);

  /* --- recommended actions, most important first --- */
  const recIds: string[] = [];
  for (const a of [...include].sort((x, y) => y.score - x.score)) for (const id of a.recommendationIds) if (!recIds.includes(id)) recIds.push(id);
  const actions = recIds
    .map((id) => recById.get(id))
    .filter((r): r is Recommendation => !!r)
    .slice(0, 6)
    .map((r, i) => ({ n: i + 1, recommendationId: r.id, text: `${r.title}${describePriceAction(r) ? ` — ${describePriceAction(r)}` : ''}` }));

  const critical = include.filter((a) => a.tier === 'critical').length;
  const headline = include.length
    ? `${include.length} item${include.length > 1 ? 's' : ''} need attention${critical ? `, ${critical} critical` : ''}. Top: ${[...include].sort((x, y) => y.score - x.score)[0].title}.`
    : 'Nothing unusual: all monitored metrics are within this hotel\'s normal range.';

  const watching = report.evaluations
    .filter((e) => e.classification === 'watch' && specFor(e.metric, profile)?.alerting !== false && !include.some((a) => report.situations.find((s) => s.id === a.situationId)?.anomalyIds.includes(e.id)))
    .map((e) => `${e.label}: ${e.direction === 'up' ? 'above' : 'below'} typical by ${round(Math.abs(e.deviationPct), 0)}% (below the alert threshold)`);

  return {
    hotel: profile.name,
    date: report.date,
    audience: role ? ROLE_LABELS[role] : 'General Manager',
    headline,
    kpis,
    sections: ordered,
    actions,
    watching,
    footer: `${report.suppressed.noise} low-importance item(s) and ${report.suppressed.repeats} repeat alert(s) were held back.`,
  };
};

export const renderBriefMarkdown = (b: Brief): string => {
  const lines: string[] = [`# ${b.hotel} — Morning Intelligence Brief`, `_${dowName(b.date)} ${b.date} · for ${b.audience}_`, '', `**${b.headline}**`, ''];
  if (b.kpis.length) {
    lines.push('## Yesterday at a glance', ...b.kpis.map((k) => `- ${k}`), '');
  }
  for (const sec of b.sections) {
    lines.push(`## ${sec.title}`);
    for (const it of sec.items) lines.push(`- **${it.title}** [${it.tier}] ${it.text}`);
    lines.push('');
  }
  if (b.actions.length) lines.push('## Recommended actions', ...b.actions.map((a) => `${a.n}. ${a.text}`), '');
  if (b.watching.length) lines.push('## Watching', ...b.watching.map((w) => `- ${w}`), '');
  lines.push(`_${b.footer}_`);
  return lines.join('\n');
};
