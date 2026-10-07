import { readFileSync } from 'node:fs';
import { AnthropicNarrator } from '../copilot/narrator';
import { HOTEL_MERIDIAN } from '../demo/simulator';
import { registerStandardAdapters } from '../integration/standard';
import { FileJournal } from '../persistence/journal';
import { HotelIntelligence } from '../platform';
import type { HotelProfile } from '../types';
import { buildDelivery } from '../delivery/config';
import { DeliveryService } from '../delivery/deliveryService';
import { createService, runDailyCycle } from './server';

/**
 * Runs the platform for one hotel as a long-lived service.
 *
 *   HOTEL_API_TOKEN   required: bearer token for the management API
 *   WEBHOOK_SECRETS   JSON map adapterId → secret, e.g. {"pms.webhook":"..."}
 *   HOTEL_PROFILE     path to a HotelProfile JSON file (defaults to the demo hotel, with a warning)
 *   JOURNAL_PATH      append-only journal (default ./data/journal.jsonl)
 *   PORT              default 8080
 *   DELIVERY_CONFIG   path to a JSON file of notifiers + routes (Slack / signed webhooks); omit to disable delivery
 *   USE_LLM=1         narrate answers/briefs with Claude (needs ANTHROPIC_API_KEY)
 */
const main = async (): Promise<void> => {
  const apiToken = process.env.HOTEL_API_TOKEN;
  if (!apiToken) throw new Error('HOTEL_API_TOKEN is required');

  let profile: HotelProfile = HOTEL_MERIDIAN;
  if (process.env.HOTEL_PROFILE) profile = JSON.parse(readFileSync(process.env.HOTEL_PROFILE, 'utf8')) as HotelProfile;
  else console.warn('HOTEL_PROFILE not set: running with the demo hotel profile');

  const journal = new FileJournal(process.env.JOURNAL_PATH ?? './data/journal.jsonl');
  const { entries, droppedPartialTail } = journal.readAll();

  const hotel = new HotelIntelligence(profile, {
    journal,
    narrator: process.env.USE_LLM === '1' ? new AnthropicNarrator() : undefined,
  });
  registerStandardAdapters(hotel);

  const started = Date.now();
  await hotel.restore(entries);
  console.log(
    `restored ${entries.length} journal entries in ${Date.now() - started}ms (asOf ${hotel.asOf ?? 'none'}, ${hotel.events.size} events)${droppedPartialTail ? '; dropped a torn final line' : ''}`,
  );

  let delivery: DeliveryService | undefined;
  if (process.env.DELIVERY_CONFIG) {
    const { notifiers, routes } = buildDelivery(JSON.parse(readFileSync(process.env.DELIVERY_CONFIG, 'utf8')));
    delivery = new DeliveryService(hotel, notifiers, routes, { journal, delivered: DeliveryService.deliveredKeys(entries), log: console.error });
    console.log(`delivery enabled: ${routes.length} route(s) via ${Object.keys(notifiers).join(', ')}`);
  }

  const server = createService(hotel, { apiToken, webhookSecrets: JSON.parse(process.env.WEBHOOK_SECRETS ?? '{}') as Record<string, string>, delivery, log: console.error });
  const tick = (): void => {
    runDailyCycle(hotel, delivery, Date.now()).then(
      (r) => (r.closed.length || r.sent || r.failed) && console.log(`closed: ${r.closed.join(', ') || '-'}; delivered ${r.sent}, failed ${r.failed}`),
      (e) => console.error('daily cycle failed', e),
    );
  };
  setInterval(tick, 60_000).unref();
  tick();

  const port = Number(process.env.PORT ?? 8080);
  server.listen(port, () => console.log(`listening on :${port}`));
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
