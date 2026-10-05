import type { Recommendation, RecommendationType } from '../types';

/** The only place the platform can change anything in a hotel system. Adapters implement this per vendor. */
export interface ActionExecutor {
  execute(rec: Recommendation): Promise<{ ok: boolean; detail: string }>;
}

/** Default executor: records intent, touches nothing. Safe until a hotel wires a real one. */
export class DryRunExecutor implements ActionExecutor {
  readonly log: Recommendation[] = [];
  async execute(rec: Recommendation): Promise<{ ok: boolean; detail: string }> {
    this.log.push(rec);
    return { ok: true, detail: `dry-run: would execute ${rec.type} ${JSON.stringify(rec.params)}` };
  }
}

/**
 * "Recommendation → Automated rule → Action" is opt-in per action type, with hard limits.
 * Anything that does not match a rule stays a human decision.
 */
export interface AutomationRule {
  type: RecommendationType;
  /** Max absolute % rate change this rule may apply without a human. */
  maxAbsChangePct: number;
  /** Minimum recommendation confidence. */
  minConfidence: number;
  /** Restrict to these categories; omit for all. */
  categories?: string[];
  /** Only rate *increases*? Automating discounts is a much riskier default. */
  increasesOnly?: boolean;
}

export interface AuditEntry {
  at: number;
  recommendationId: string;
  actor: string;
  from: Recommendation['status'];
  to: Recommendation['status'];
  note?: string;
}

export class ApprovalWorkflow {
  private recs = new Map<string, Recommendation>();
  readonly audit: AuditEntry[] = [];

  constructor(
    private executor: ActionExecutor = new DryRunExecutor(),
    private rules: AutomationRule[] = [],
    private clock: () => number = Date.now,
  ) {}

  /** Registers new recommendations; auto-executes those matching an enabled rule. Re-submitting is idempotent. */
  async submit(recs: Recommendation[]): Promise<Recommendation[]> {
    const out: Recommendation[] = [];
    for (const r of recs) {
      const existing = this.recs.get(r.id);
      if (existing) {
        out.push(existing);
        continue;
      }
      this.recs.set(r.id, r);
      out.push(r);
      if (this.eligibleForAutomation(r)) await this.run(r, 'automation-rule', 'auto_executed');
    }
    return out;
  }

  async approve(id: string, actor: string, note?: string): Promise<Recommendation> {
    const r = this.mustGet(id);
    if (r.status !== 'proposed') throw new Error(`Recommendation ${id} is ${r.status}, not proposed`);
    this.transition(r, actor, 'approved', note);
    return this.run(r, actor, 'executed');
  }

  reject(id: string, actor: string, reason: string): Recommendation {
    const r = this.mustGet(id);
    if (r.status !== 'proposed') throw new Error(`Recommendation ${id} is ${r.status}, not proposed`);
    this.transition(r, actor, 'rejected', reason);
    return r;
  }

  get(id: string): Recommendation | undefined {
    return this.recs.get(id);
  }

  list(status?: Recommendation['status']): Recommendation[] {
    return [...this.recs.values()].filter((r) => !status || r.status === status);
  }

  private eligibleForAutomation(r: Recommendation): boolean {
    return this.rules.some((rule) => {
      if (rule.type !== r.type || r.confidence < rule.minConfidence) return false;
      if (rule.categories && !rule.categories.includes(String(r.params.category))) return false;
      const change = Number(r.params.changePct);
      if (!Number.isFinite(change)) return false; // only price moves are automatable today
      if (rule.increasesOnly && change < 0) return false;
      return Math.abs(change) <= rule.maxAbsChangePct;
    });
  }

  private async run(r: Recommendation, actor: string, success: 'executed' | 'auto_executed'): Promise<Recommendation> {
    try {
      const res = await this.executor.execute(r);
      this.transition(r, actor, res.ok ? success : 'failed', res.detail);
    } catch (e) {
      this.transition(r, actor, 'failed', e instanceof Error ? e.message : String(e));
    }
    return r;
  }

  private mustGet(id: string): Recommendation {
    const r = this.recs.get(id);
    if (!r) throw new Error(`Unknown recommendation ${id}`);
    return r;
  }

  private transition(r: Recommendation, actor: string, to: Recommendation['status'], note?: string): void {
    this.audit.push({ at: this.clock(), recommendationId: r.id, actor, from: r.status, to, note });
    r.status = to;
  }
}
