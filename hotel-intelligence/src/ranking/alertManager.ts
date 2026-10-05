import type { Alert, DateKey, Tier } from '../types';

const TIER_ORDER: Tier[] = ['noise', 'informational', 'important', 'critical'];

/**
 * Anti-flood layer. A persisting issue should not re-page people every night. An alert is
 * suppressed if the same issue (dedupe key) was surfaced within the cooldown and has neither
 * escalated a tier nor gained meaningfully in score. Noise is never surfaced.
 */
export class AlertManager {
  private lastSeen = new Map<string, { date: DateKey; tier: Tier; score: number }>();
  readonly history: Alert[] = [];

  constructor(private cooldownDays = 2) {}

  /** Returns the alerts that should be surfaced, plus counts of what was held back (for transparency). */
  filter(alerts: Alert[], date: DateKey): { surfaced: Alert[]; suppressedNoise: number; suppressedRepeats: number } {
    let suppressedNoise = 0;
    let suppressedRepeats = 0;
    const surfaced: Alert[] = [];
    for (const a of [...alerts].sort((x, y) => y.score - x.score)) {
      if (a.tier === 'noise') {
        suppressedNoise++;
        continue;
      }
      const prev = this.lastSeen.get(a.dedupeKey);
      if (prev && prev.date !== date) {
        const ageDays = Math.round((Date.parse(date) - Date.parse(prev.date)) / 86_400_000);
        const escalated = TIER_ORDER.indexOf(a.tier) > TIER_ORDER.indexOf(prev.tier) || a.score - prev.score >= 0.15;
        if (ageDays >= 0 && ageDays < Math.max(this.cooldownDays, a.cooldownDays) && !escalated) {
          suppressedRepeats++;
          continue;
        }
      }
      this.lastSeen.set(a.dedupeKey, { date, tier: a.tier, score: a.score });
      surfaced.push(a);
      this.history.push(a);
    }
    return { surfaced, suppressedNoise, suppressedRepeats };
  }
}
