import { renderBriefMarkdown } from '../briefing/dailyBrief';
import { describePriceAction } from '../decision/decisionEngine';
import type { JournalEntry, JournalSink } from '../persistence/journal';
import type { HotelIntelligence } from '../platform';
import { alertsForRole, ROLE_LABELS } from '../ranking/roles';
import type { Alert, DateKey, DayReport, Role } from '../types';
import { addDays, toDateKey } from '../util/time';
import { sendWithRetry, type Message, type Notifier, type RetryOptions } from './notifier';

export interface Route {
  role: Role;
  /** Name of a registered notifier. */
  notifier: string;
}

export interface DeliverySummary {
  sent: number;
  alreadyDelivered: number;
  failed: { key: string; error: string }[];
}

const empty = (): DeliverySummary => ({ sent: 0, alreadyDelivered: 0, failed: [] });

/**
 * Sends what the routing engine decided: critical+relevant alerts immediately, "review today" items
 * as one grouped message, and each role's morning brief.
 *
 * Delivery is an external side effect, so it follows the same rules as executing a price change:
 *  - it is separate from analysis, so rebuilding state from the journal never notifies anyone;
 *  - each message has an idempotency key that is journaled only after a successful send, which gives
 *    at-least-once delivery without duplicates across retries and restarts;
 *  - one broken channel never blocks the others, and a failed message is retried on the next run.
 */
export class DeliveryService {
  private delivered: Set<string>;
  private lock: Promise<unknown> = Promise.resolve();

  constructor(
    private hotel: HotelIntelligence,
    private notifiers: Record<string, Notifier>,
    private routes: Route[],
    private opts: { journal?: JournalSink; delivered?: Iterable<string>; retry?: Partial<RetryOptions>; log?: (m: string) => void; lookbackDays?: number } = {},
  ) {
    for (const r of routes) if (!notifiers[r.notifier]) throw new Error(`Route for ${r.role} refers to unknown notifier "${r.notifier}"`);
    this.delivered = new Set(opts.delivered ?? []);
  }

  /** Delivered keys recorded in a journal; pass to the constructor on startup. */
  static deliveredKeys(entries: JournalEntry[]): string[] {
    return entries.flatMap((e) => (e.t === 'delivered' ? [e.key] : []));
  }

  deliverDay(date: DateKey): Promise<DeliverySummary> {
    return this.exclusive(() => this.run(date));
  }

  /** Delivers any recent closed day that still has unsent messages (e.g. after a crash or an outage). */
  deliverPending(now: number): Promise<DeliverySummary> {
    return this.exclusive(async () => {
      const total = empty();
      const oldest = addDays(toDateKey(now, this.hotel.profile.tzOffsetMinutes), -(this.opts.lookbackDays ?? 2));
      for (const d of this.hotel.closedDates().filter((x) => x >= oldest)) {
        const s = await this.run(d);
        total.sent += s.sent;
        total.alreadyDelivered += s.alreadyDelivered;
        total.failed.push(...s.failed);
      }
      return total;
    });
  }

  /* ------------------------------------------------------------ */

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.lock.then(fn);
    this.lock = next.catch(() => undefined);
    return next;
  }

  private async run(date: DateKey): Promise<DeliverySummary> {
    const summary = empty();
    const report = this.hotel.report(date);
    if (!report) return summary;
    for (const route of this.routes) {
      for (const { key, message } of this.messagesFor(report, route.role)) {
        const full = `${date}|${route.role}|${route.notifier}|${key}`;
        if (this.delivered.has(full)) {
          summary.alreadyDelivered++;
          continue;
        }
        try {
          await sendWithRetry(this.notifiers[route.notifier], message, this.opts.retry);
          this.delivered.add(full);
          this.opts.journal?.append({ t: 'delivered', key: full });
          summary.sent++;
        } catch (e) {
          const error = e instanceof Error ? e.message : 'delivery failed';
          summary.failed.push({ key: full, error });
          this.opts.log?.(`delivery failed (${full}): ${error}`);
        }
      }
    }
    return summary;
  }

  private messagesFor(report: DayReport, role: Role): { key: string; message: Message }[] {
    const routed = alertsForRole(report.surfaced, role);
    const out: { key: string; message: Message }[] = [];
    const recLines = (a: Alert): string =>
      a.recommendationIds
        .map((id) => report.recommendations.find((r) => r.id === id))
        .filter((r): r is NonNullable<typeof r> => !!r)
        .map((r) => `→ ${r.title}${describePriceAction(r) ? ` — ${describePriceAction(r)}` : ''}`)
        .join('\n');

    for (const { alert } of routed.filter((r) => r.delivery === 'push')) {
      out.push({
        key: `push:${alert.id}`,
        message: { kind: 'push', role, date: report.date, title: `[${alert.tier}] ${alert.title}`, text: [alert.body, recLines(alert)].filter(Boolean).join('\n') },
      });
    }
    const inbox = routed.filter((r) => r.delivery === 'inbox');
    if (inbox.length) {
      out.push({
        key: 'inbox',
        message: {
          kind: 'inbox',
          role,
          date: report.date,
          title: `Review today (${inbox.length})`,
          text: inbox.map(({ alert }) => [`• ${alert.title}`, recLines(alert)].filter(Boolean).join('\n  ')).join('\n'),
        },
      });
    }
    // The brief goes out every day, including quiet ones: silence should mean "all normal", not "system down".
    out.push({
      key: 'brief',
      message: { kind: 'brief', role, date: report.date, title: `Morning brief for ${ROLE_LABELS[role]} — ${report.date}`, text: renderBriefMarkdown(this.hotel.brief(report.date, role)) },
    });
    return out;
  }
}
