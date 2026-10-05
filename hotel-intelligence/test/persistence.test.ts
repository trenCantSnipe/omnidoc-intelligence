import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bootstrapSimulatedHotel, DEFAULT_SIM } from '../src/demo/bootstrap';
import { HOTEL_MERIDIAN } from '../src/demo/simulator';
import type { ActionExecutor } from '../src/decision/approval';
import { registerStandardAdapters } from '../src/integration/standard';
import { FileJournal, JournalCorruptionError } from '../src/persistence/journal';
import { HotelIntelligence } from '../src/platform';
import type { Recommendation } from '../src/types';

const tmp = () => join(mkdtempSync(join(tmpdir(), 'hotel-journal-')), 'journal.jsonl');
const asOf = DEFAULT_SIM.asOf;

const spyExecutor = () => {
  const calls: Recommendation[] = [];
  const ex: ActionExecutor = { execute: async (r) => (calls.push(r), { ok: true, detail: 'spy' }) };
  return { ex, calls };
};

describe('journal-backed recovery', () => {
  it('a restart reproduces the same conclusions and decisions without re-executing anything', async () => {
    const path = tmp();
    const a = spyExecutor();
    const { hotel: before } = await bootstrapSimulatedHotel(undefined, {
      journal: new FileJournal(path),
      executor: a.ex,
      // small Deluxe/Suite increases may run automatically; everything else needs a person
      automation: [{ type: 'ADJUST_PRICE', maxAbsChangePct: 10, minConfidence: 0.5, increasesOnly: true }],
    });
    const manual = before.report(asOf)!.recommendations.find((r) => r.type === 'INVESTIGATE')!;
    await before.approvals.approve(manual.id, 'gm@meridian', 'on it');
    expect(a.calls.length).toBeGreaterThanOrEqual(2); // one automatic price push + one approval

    // --- "restart": a brand-new instance rebuilt only from the file ---
    const b = spyExecutor();
    const after = new HotelIntelligence(HOTEL_MERIDIAN, { executor: b.ex, journal: new FileJournal(path) });
    registerStandardAdapters(after);
    const { entries, droppedPartialTail } = new FileJournal(path).readAll();
    expect(droppedPartialTail).toBe(false);
    const linesBefore = readFileSync(path, 'utf8').split('\n').filter(Boolean).length;
    await after.restore(entries);

    expect(b.calls).toHaveLength(0); // nothing is pushed to a PMS just because the process restarted
    expect(readFileSync(path, 'utf8').split('\n').filter(Boolean)).toHaveLength(linesBefore); // restore does not re-journal
    expect(after.asOf).toBe(before.asOf);
    expect(after.events.size).toBe(before.events.size);
    expect(JSON.stringify(after.brief(asOf))).toBe(JSON.stringify(before.brief(asOf)));
    expect(after.approvals.list().map((r) => [r.id, r.status])).toEqual(before.approvals.list().map((r) => [r.id, r.status]));
    expect(after.approvals.audit).toEqual(before.approvals.audit);
    expect(after.approvals.get(manual.id)?.status).toBe('executed');
    expect(after.approvals.list('auto_executed').length).toBeGreaterThan(0);

    // the restored instance keeps working: new input is journaled and decisions can still be made
    const pending = after.approvals.list('proposed')[0];
    await after.approvals.approve(pending.id, 'rm@meridian');
    expect(b.calls).toHaveLength(1);
    expect(readFileSync(path, 'utf8').split('\n').filter(Boolean).length).toBeGreaterThan(linesBefore);
  }, 30_000);

  it('drops a torn final line (crash mid-write) but refuses a corrupt middle', () => {
    const path = tmp();
    const j = new FileJournal(path);
    j.append({ t: 'close', date: '2026-10-01' });
    j.append({ t: 'close', date: '2026-10-02' });
    appendFileSync(path, '{"t":"obs","obs":[{"kind":"ra'); // process died mid-write
    const r = j.readAll();
    expect(r.entries).toHaveLength(2);
    expect(r.droppedPartialTail).toBe(true);

    const bad = tmp();
    writeFileSync(bad, '{"t":"close","date":"2026-10-01"}\nNOT JSON\n{"t":"close","date":"2026-10-02"}\n');
    expect(() => new FileJournal(bad).readAll()).toThrow(JournalCorruptionError);
  });

  it('an empty or missing journal is simply a fresh hotel', () => {
    expect(new FileJournal(tmp()).readAll()).toEqual({ entries: [], droppedPartialTail: false });
  });

  it('refuses to restore a decision that refers to a recommendation it cannot reproduce', async () => {
    const h = new HotelIntelligence(HOTEL_MERIDIAN);
    await expect(
      h.restore([{ t: 'audit', entry: { at: 1, recommendationId: 'rec_missing', actor: 'x', from: 'proposed', to: 'executed' } }]),
    ).rejects.toThrow(/unknown recommendation/);
  });
});
