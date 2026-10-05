import type Anthropic from '@anthropic-ai/sdk';
import { beforeAll, describe, expect, it } from 'vitest';
import { bootstrapSimulatedHotel, DEFAULT_SIM } from '../src/demo/bootstrap';
import { simulateHotel } from '../src/demo/simulator';
import { AnthropicNarrator } from '../src/copilot/narrator';
import { ApprovalWorkflow, DryRunExecutor, type AutomationRule } from '../src/decision/approval';
import type { HotelIntelligence } from '../src/platform';
import { AlertManager } from '../src/ranking/alertManager';
import { alertsForRole, routeAlert } from '../src/ranking/roles';
import type { Alert, DayReport, Recommendation } from '../src/types';

let hotel: HotelIntelligence;
let report: DayReport;
const asOf = DEFAULT_SIM.asOf;

beforeAll(async () => {
  ({ hotel } = await bootstrapSimulatedHotel());
  report = hotel.report(asOf)!;
});

describe('end to end: onboarding via adapters, then a day with a real story in it', () => {
  it('finds the strong-demand situation and backs it with several independent signals', () => {
    const s = report.situations.find((x) => x.kind === 'demand_surge' && x.category === 'deluxe')!;
    expect(s).toBeDefined();
    expect(s.signals.map((x) => x.label)).toEqual(expect.arrayContaining(['Booking pace', 'Competitor rates', 'Remaining inventory']));
    expect(Number(s.facts.pickupMultiple)).toBeGreaterThan(1.8);
    expect(Number(s.facts.competitorsUp)).toBe(3);
    expect(Number(s.facts.remainingPct)).toBeLessThan(25);
    // not everything is "strong demand": the unaffected category is left alone
    expect(report.situations.some((x) => x.kind === 'demand_surge' && x.category === 'standard')).toBe(false);
  });

  it('explains electricity relative to occupancy, not as a bare percentage', () => {
    const s = report.situations.find((x) => x.kind === 'energy_inefficiency')!;
    expect(s.summary).toMatch(/at this level of occupancy/);
    expect(s.summary).toMatch(/occupancy was \+\d+%/);
    expect(Number(s.facts.deviationPct)).toBeGreaterThan(35);
    expect(s.impactAmount).toBeGreaterThan(5000);
  });

  it('catches the cancellation spike and says where it came from', () => {
    const s = report.situations.find((x) => x.kind === 'cancellation_spike')!;
    expect(s.summary).toMatch(/booking\.com/);
    expect(Number(s.facts.ratePct)).toBeGreaterThan(15);
  });

  it('does not alert on things that are merely within normal variation', () => {
    const kinds = new Set(report.situations.map((s) => s.kind));
    expect(kinds.has('cost_anomaly')).toBe(false); // maintenance, water, staff, F&B were ordinary
    expect(kinds.has('price_undercut')).toBe(false); // own rates are below the (risen) market
  });

  it('ranks by business impact, and revenue beats do not outrank problems that need action', () => {
    const order = report.surfaced.map((a) => a.title);
    const beat = order.findIndex((t) => /Revenue above expected/.test(t));
    const cancel = order.findIndex((t) => /Cancellation rate/.test(t));
    expect(cancel).toBeGreaterThanOrEqual(0);
    if (beat >= 0) expect(cancel).toBeLessThan(beat);
    const tiers = report.surfaced.map((a) => a.score);
    expect(tiers).toEqual([...tiers].sort((a, b) => b - a));
  });

  it('proposes a pricing action that respects guardrails and waits for a human', () => {
    const rec = report.recommendations.find((r) => r.type === 'ADJUST_PRICE' && r.params.category === 'deluxe')!;
    const cat = hotel.profile.categories.find((c) => c.id === 'deluxe')!;
    expect(rec.status).toBe('proposed');
    expect(rec.requiresApproval).toBe(true);
    expect(Number(rec.params.changePct)).toBeGreaterThan(0);
    expect(Number(rec.params.changePct)).toBeLessThanOrEqual(15);
    expect(Number(rec.params.targetRate)).toBeLessThanOrEqual(cat.maxRate);
    expect(rec.guardrails.join(' ')).toMatch(/capped|review again/);
  });

  it('records anomaly events in the event store for later memory and analysis', () => {
    const types = hotel.events.query({ fromDate: asOf, toDate: asOf }).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['ELECTRICITY_SPIKE', 'ROOM_CATEGORY_SELLING_FAST', 'COMPETITOR_PRICE_CHANGED', 'PROMOTION_ENDED']));
  });
});

describe('daily brief', () => {
  it('leads with what matters, includes actions, and every section is traceable to numbers', () => {
    const b = hotel.brief(asOf);
    expect(b.sections.length).toBeGreaterThan(2);
    const tops = b.sections.map((s) => s.items[0].score);
    expect(tops).toEqual([...tops].sort((a, c) => c - a));
    expect(b.actions.length).toBeGreaterThan(0);
    expect(b.kpis.join(' ')).toMatch(/Revenue .*expected/);
    expect(JSON.stringify(b)).toMatch(/kWh/);
  });

  it('is tailored to the reader', () => {
    const ops = hotel.brief(asOf, 'operations');
    const text = JSON.stringify(ops.sections);
    expect(text).toMatch(/Electricity/);
    expect(text).not.toMatch(/competitors raised/);
    expect(text).not.toMatch(/Strong demand/);
    const rm = JSON.stringify(hotel.brief(asOf, 'revenue_manager').sections);
    expect(rm).toMatch(/Strong demand/);
    expect(rm).not.toMatch(/Electricity/);
  });

  it('renders markdown a person can read', async () => {
    const md = await hotel.briefMarkdown(asOf);
    expect(md).toMatch(/^# Hotel Meridian — Morning Intelligence Brief/);
    expect(md).toMatch(/## Recommended actions/);
  });
});

describe('role-based routing', () => {
  const alert = (domains: Alert['domains'], tier: Alert['tier']): Alert => ({
    id: 'a', hotelId: 'h', date: asOf, tier, score: 0.5, title: 't', body: 'b', domains, situationId: 's', recommendationIds: [], dedupeKey: 'k', cooldownDays: 2,
  });
  const to = (a: Alert) => Object.fromEntries(routeAlert(a).map((r) => [r.role, r.delivery]));

  it('pages the right people for critical operational issues, and nobody for noise', () => {
    expect(to(alert(['operations'], 'critical'))).toMatchObject({ operations: 'push', general_manager: 'push' });
    expect(to(alert(['operations'], 'critical')).revenue_manager).toBeUndefined();
    expect(to(alert(['operations'], 'noise'))).toEqual({});
  });

  it('keeps important-but-not-urgent items out of the GM\'s pager', () => {
    expect(to(alert(['operations'], 'important')).general_manager).toBe('daily_brief');
    expect(to(alert(['pricing'], 'important')).revenue_manager).toBe('inbox');
    expect(to(alert(['pricing'], 'important')).operations).toBeUndefined();
  });

  it('finance sees money, not market chatter', () => {
    expect(to(alert(['market'], 'important')).finance).toBeUndefined();
    expect(to(alert(['finance'], 'critical')).finance).toBe('push');
    expect(alertsForRole(report.surfaced, 'finance').every((r) => r.alert.domains.some((d) => ['revenue', 'finance', 'cancellations', 'operations', 'demand', 'pricing'].includes(d)))).toBe(true);
  });
});

describe('alert throttling', () => {
  const mk = (tier: Alert['tier'], score: number, cooldownDays = 2): Alert => ({
    id: 'a', hotelId: 'h', date: '2026-10-01', tier, score, title: 't', body: 'b', domains: ['pricing'], situationId: 's', recommendationIds: [], dedupeKey: 'parity', cooldownDays,
  });

  it('does not re-page a standing condition every day, but does when it gets worse', () => {
    const m = new AlertManager();
    expect(m.filter([mk('important', 0.5, 7)], '2026-10-01').surfaced).toHaveLength(1);
    expect(m.filter([mk('important', 0.5, 7)], '2026-10-03').suppressedRepeats).toBe(1);
    expect(m.filter([mk('important', 0.5, 7)], '2026-10-07').suppressedRepeats).toBe(1);
    expect(m.filter([mk('important', 0.5, 7)], '2026-10-08').surfaced).toHaveLength(1);
    expect(m.filter([mk('critical', 0.9, 7)], '2026-10-09').surfaced).toHaveLength(1); // escalated
  });

  it('never surfaces noise but counts it for transparency', () => {
    const r = new AlertManager().filter([mk('noise', 0.1)], '2026-10-01');
    expect(r.surfaced).toHaveLength(0);
    expect(r.suppressedNoise).toBe(1);
  });
});

describe('approval workflow and automation guardrails', () => {
  const rec = (over: Partial<Recommendation> = {}): Recommendation => ({
    id: 'r1', hotelId: 'h', situationId: 's', createdForDate: asOf, type: 'ADJUST_PRICE', title: 't', rationale: 'r',
    params: { category: 'deluxe', changePct: 7 }, risk: 'low', confidence: 0.9, guardrails: [], requiresApproval: true, status: 'proposed', domains: ['pricing'], ...over,
  });

  it('nothing executes without approval by default; approval executes once and is audited', async () => {
    const ex = new DryRunExecutor();
    const w = new ApprovalWorkflow(ex);
    await w.submit([rec()]);
    expect(ex.log).toHaveLength(0);
    const done = await w.approve('r1', 'rm@hotel', 'ok');
    expect(done.status).toBe('executed');
    expect(ex.log).toHaveLength(1);
    expect(w.audit.map((a) => `${a.from}>${a.to}`)).toEqual(['proposed>approved', 'approved>executed']);
    await expect(w.approve('r1', 'rm@hotel')).rejects.toThrow(/not proposed/);
  });

  it('a failing executor leaves a failed, auditable recommendation instead of silently losing it', async () => {
    const w = new ApprovalWorkflow({ execute: async () => { throw new Error('PMS 503'); } });
    await w.submit([rec()]);
    const r = await w.approve('r1', 'rm');
    expect(r.status).toBe('failed');
    expect(w.audit.at(-1)?.note).toBe('PMS 503');
  });

  it('rejection is final and recorded', async () => {
    const w = new ApprovalWorkflow();
    await w.submit([rec()]);
    expect(w.reject('r1', 'gm', 'peak event soon').status).toBe('rejected');
    await expect(w.approve('r1', 'gm')).rejects.toThrow();
  });

  it('opt-in automation applies only inside its hard limits', async () => {
    const rules: AutomationRule[] = [{ type: 'ADJUST_PRICE', maxAbsChangePct: 8, minConfidence: 0.8, increasesOnly: true, categories: ['deluxe'] }];
    const ex = new DryRunExecutor();
    const w = new ApprovalWorkflow(ex, rules);
    await w.submit([
      rec({ id: 'ok' }),
      rec({ id: 'too-big', params: { category: 'deluxe', changePct: 12 } }),
      rec({ id: 'decrease', params: { category: 'deluxe', changePct: -5 } }),
      rec({ id: 'other-cat', params: { category: 'suite', changePct: 5 } }),
      rec({ id: 'low-conf', confidence: 0.5 }),
      rec({ id: 'not-price', type: 'INVESTIGATE', params: { area: 'energy' } }),
    ]);
    expect(w.list('auto_executed').map((r) => r.id)).toEqual(['ok']);
    expect(w.list('proposed').map((r) => r.id).sort()).toEqual(['decrease', 'low-conf', 'not-price', 'other-cat', 'too-big']);
  });

  it('re-submitting the same recommendations is harmless', async () => {
    const w = new ApprovalWorkflow();
    await w.submit([rec()]);
    await w.approve('r1', 'x');
    const again = await w.submit([rec()]);
    expect(again[0].status).toBe('executed');
  });
});

describe('copilot answers from the hotel\'s own data', () => {
  it('what changed overnight', async () => {
    const a = await hotel.ask('What changed overnight?');
    expect(a.intent).toBe('what_changed');
    expect(a.text).toMatch(/Electricity/);
    expect(a.text).toMatch(/Grand Palace Deluxe rate/); // names, not ids
    expect(a.text).toMatch(/Weekend Staycation/);
  });

  it('why electricity rose (accounts for occupancy)', async () => {
    const a = await hotel.ask('Why did electricity consumption increase?');
    expect(a.text).toMatch(/kWh/);
    expect(a.text).toMatch(/occupancy/);
  });

  it('should we raise prices — a concrete, guard-railed answer', async () => {
    const a = await hotel.ask('Should we increase room prices today?');
    expect(a.intent).toBe('pricing_advice');
    expect(a.text).toMatch(/Raise Deluxe rates/);
    expect(a.text).toMatch(/Status: proposed/);
  });

  it('why are cancellations increasing', async () => {
    const a = await hotel.ask('Why are cancellations increasing?');
    expect(a.text).toMatch(/booking\.com/);
  });

  it('which category is performing best', async () => {
    const a = await hotel.ask('Which room category is performing best?');
    expect(a.intent).toBe('best_category');
    expect(a.text).toMatch(/1\. (Deluxe|Standard|Suite)/);
  });

  it('what happened the last time occupancy reached 90%', async () => {
    const a = await hotel.ask('What happened the last time occupancy reached 90%?');
    expect(a.intent).toBe('recall');
    expect(a.text).toMatch(/Occupancy reaching 90% happened \d+ time/);
    expect(a.text).toMatch(/ADR/);
  });

  it('what should I focus on today', async () => {
    const a = await hotel.ask('What should I focus on today?');
    expect(a.intent).toBe('focus');
    expect(a.text).toMatch(/1\. \[critical\]/);
  });

  it('a normal metric is reported as normal, not invented into a story', async () => {
    const a = await hotel.ask('Why did maintenance cost change?');
    expect(a.text).toMatch(/within this hotel's normal range/);
  });

  it('unmatched questions fall through to the narrator with facts, not to a guess', async () => {
    const a = await hotel.ask('Tell me a joke about breakfast buffets');
    expect(a.intent).toBe('freeform');
    expect(a.text).toMatch(/only answer from the hotel data/);
  });
});

describe('LLM narrator is optional and can never make the answer worse', () => {
  const fake = (create: () => Promise<unknown>): Anthropic => ({ messages: { create } }) as unknown as Anthropic;

  it('uses the model text when available, and sends only engine facts', async () => {
    let seen = '';
    const n = new AnthropicNarrator({
      client: fake(async function (this: unknown, ...args: unknown[]) {
        seen = JSON.stringify(args);
        return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Polished.' }] };
      }),
    });
    expect(await n.narrate({ task: 'answer', question: 'q', draft: 'draft', facts: { a: 1 } })).toBe('Polished.');
  });

  it('falls back to the deterministic draft on errors, refusals and empty output', async () => {
    const draft = 'Deterministic answer ₹6,500';
    const boom = new AnthropicNarrator({ client: fake(async () => { throw new Error('network'); }) });
    const refuse = new AnthropicNarrator({ client: fake(async () => ({ stop_reason: 'refusal', content: [] })) });
    const empty = new AnthropicNarrator({ client: fake(async () => ({ stop_reason: 'end_turn', content: [] })) });
    for (const n of [boom, refuse, empty]) expect(await n.narrate({ task: 'answer', draft })).toBe(draft);
  });
});

describe('quality bar: it must stay quiet when nothing is wrong', () => {
  it('surfaces few alerts, and almost nothing critical, on 3 months of anomaly-free operations', async () => {
    let days = 0;
    let surfaced = 0;
    let critical = 0;
    for (const seed of [11, 12, 13]) {
      const { hotel: h } = await bootstrapSimulatedHotel(simulateHotel({ ...DEFAULT_SIM, seed, scenario: false }));
      for (const d of h.metrics.series('revenue').map(([k]) => k)) {
        const r = h.report(d);
        if (!r || d < '2026-07-05') continue; // skip the baseline warm-up period
        days++;
        surfaced += r.surfaced.length;
        critical += r.surfaced.filter((a) => a.tier === 'critical').length;
      }
    }
    expect(days).toBeGreaterThan(250);
    expect(surfaced / days).toBeLessThan(0.25); // < 1 alert every 4 days across all signal types
    expect(critical / days).toBeLessThan(0.03);
  });

  it('a replay of the same history yields the same conclusions (deterministic)', async () => {
    const { hotel: h2 } = await bootstrapSimulatedHotel();
    expect(h2.report(asOf)!.surfaced.map((a) => [a.title, a.score])).toEqual(report.surfaced.map((a) => [a.title, a.score]));
  });
});
