import { AnthropicNarrator } from '../copilot/narrator';
import { ROLE_LABELS, alertsForRole } from '../ranking/roles';
import type { Role } from '../types';
import { bootstrapSimulatedHotel } from './bootstrap';

const useLlm = process.argv.includes('--llm');

const main = async (): Promise<void> => {
  const { hotel, sim } = await bootstrapSimulatedHotel(undefined, useLlm ? { narrator: new AnthropicNarrator() } : {});
  const report = hotel.report(sim.asOf)!;

  console.log(`\nIngested ${hotel.events.size} events across ${hotel.registry.list().length} adapters; baselines learned from ${sim.history.reservationsCsv.split('\n').length - 1} reservations.`);
  console.log(`Narration: ${useLlm ? 'Claude (grounded in engine facts)' : 'deterministic (pass --llm with ANTHROPIC_API_KEY to use Claude)'}\n`);

  console.log('═'.repeat(78));
  console.log(await hotel.briefMarkdown(sim.asOf));
  console.log('═'.repeat(78));

  console.log('\nWHO GETS WHAT');
  for (const role of Object.keys(ROLE_LABELS) as Role[]) {
    const routed = alertsForRole(report.surfaced, role);
    console.log(`\n  ${ROLE_LABELS[role]}`);
    if (!routed.length) console.log('    (nothing)');
    for (const r of routed) console.log(`    ${r.delivery.padEnd(11)} [${r.alert.tier}] ${r.alert.title}`);
  }

  console.log('\nCOPILOT');
  for (const q of [
    'What changed overnight?',
    'Why did electricity consumption increase?',
    'Why are cancellations increasing?',
    'Should we increase room prices today?',
    'Which room category is performing best?',
    'What happened the last time occupancy reached 90%?',
    'What should I focus on today?',
  ]) {
    const a = await hotel.ask(q);
    console.log(`\n  Q: ${q}\n${a.text.split('\n').map((l) => `  ${l}`).join('\n')}`);
  }

  // Human-in-the-loop: approve the pricing recommendation (dry-run executor: nothing is pushed anywhere).
  const rec = report.recommendations.find((r) => r.type === 'ADJUST_PRICE');
  if (rec) {
    const done = await hotel.approvals.approve(rec.id, 'revenue.manager@meridian.example', 'looks right');
    console.log(`\nAPPROVAL: "${done.title}" → ${done.status}`);
    console.log(`  audit: ${JSON.stringify(hotel.approvals.audit.at(-1))}`);
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
