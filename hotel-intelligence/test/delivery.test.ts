import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildDelivery } from '../src/delivery/config';
import { DeliveryService } from '../src/delivery/deliveryService';
import { MemoryNotifier, PermanentDeliveryError, SlackNotifier, TransientDeliveryError, WebhookNotifier, sendWithRetry, type Message, type Notifier } from '../src/delivery/notifier';
import { bootstrapSimulatedHotel, DEFAULT_SIM } from '../src/demo/bootstrap';
import { HOTEL_MERIDIAN } from '../src/demo/simulator';
import { registerStandardAdapters } from '../src/integration/standard';
import { verifyWebhookSignature } from '../src/integration/jsonAdapters';
import { FileJournal } from '../src/persistence/journal';
import { HotelIntelligence } from '../src/platform';
import { runDailyCycle } from '../src/service/server';
import type { Role } from '../src/types';
import { parseTimestamp } from '../src/util/time';

const asOf = DEFAULT_SIM.asOf;
const noSleep = async () => {};
const ROLES: Role[] = ['general_manager', 'revenue_manager', 'finance', 'operations'];

const memoryRoutes = () => {
  const notifiers = Object.fromEntries(ROLES.map((r) => [r, new MemoryNotifier(r)])) as Record<Role, MemoryNotifier>;
  return { notifiers, routes: ROLES.map((role) => ({ role, notifier: role })) };
};

describe('what each role receives', () => {
  let hotel: HotelIntelligence;
  beforeAll(async () => {
    ({ hotel } = await bootstrapSimulatedHotel());
  }, 30_000);

  it('pages the right people, groups the rest, and sends every role its own brief', async () => {
    const { notifiers, routes } = memoryRoutes();
    const svc = new DeliveryService(hotel, notifiers, routes, { retry: { sleep: noSleep } });
    const summary = await svc.deliverDay(asOf);
    expect(summary.failed).toEqual([]);

    const by = (r: Role, kind: Message['kind']) => notifiers[r].sent.filter((m) => m.kind === kind);
    // Operations: the electricity page, never pricing
    expect(by('operations', 'push').map((m) => m.title).join()).toMatch(/Electricity/);
    expect(notifiers.operations.sent.map((m) => m.text).join('\n')).not.toMatch(/competitors raised|Strong demand/);
    // Revenue manager: pricing opportunity is "review today", not a page
    expect(by('revenue_manager', 'inbox')[0].text).toMatch(/Strong demand for Deluxe/);
    expect(by('revenue_manager', 'inbox')[0].text).toMatch(/→ Raise Deluxe rates/); // with the recommended action
    expect(by('revenue_manager', 'push').map((m) => m.title).join()).not.toMatch(/Strong demand/);
    // GM: only criticals are pushed
    expect(by('general_manager', 'push').length).toBeGreaterThan(0);
    expect(by('general_manager', 'push').every((m) => m.title.startsWith('[critical]'))).toBe(true);
    // exactly one brief per role, written for that role
    for (const r of ROLES) expect(by(r, 'brief')).toHaveLength(1);
    expect(by('operations', 'brief')[0].text).toMatch(/for Operations/);
  });

  it('is idempotent: a second delivery of the same day sends nothing', async () => {
    const { notifiers, routes } = memoryRoutes();
    const svc = new DeliveryService(hotel, notifiers, routes, { retry: { sleep: noSleep } });
    const first = await svc.deliverDay(asOf);
    const second = await svc.deliverDay(asOf);
    expect(first.sent).toBeGreaterThan(4);
    expect(second.sent).toBe(0);
    expect(second.alreadyDelivered).toBe(first.sent);
    // concurrent calls (timer + API) cannot double-send either
    const { notifiers: n2, routes: r2 } = memoryRoutes();
    const svc2 = new DeliveryService(hotel, n2, r2, { retry: { sleep: noSleep } });
    await Promise.all([svc2.deliverDay(asOf), svc2.deliverDay(asOf), svc2.deliverDay(asOf)]);
    expect(Object.values(n2).reduce((n, m) => n + m.sent.length, 0)).toBe(first.sent);
  });

  it('a day that was never closed has nothing to deliver', async () => {
    const { notifiers, routes } = memoryRoutes();
    const s = await new DeliveryService(hotel, notifiers, routes).deliverDay('2031-01-01');
    expect(s).toEqual({ sent: 0, alreadyDelivered: 0, failed: [] });
  });

  it('refuses a route that points at a notifier that does not exist', () => {
    expect(() => new DeliveryService(hotel, {}, [{ role: 'finance', notifier: 'ghost' }])).toThrow(/unknown notifier "ghost"/);
  });
});

describe('failure handling', () => {
  let hotel: HotelIntelligence;
  beforeAll(async () => {
    ({ hotel } = await bootstrapSimulatedHotel());
  }, 30_000);

  it('one broken channel does not block the others, and its messages are retried later — once', async () => {
    const { notifiers, routes } = memoryRoutes();
    let broken = true;
    const flaky: Notifier = {
      name: 'gm-slack',
      send: async (m) => {
        if (broken) throw new TransientDeliveryError('gm-slack: receiver returned 503');
        await notifiers.general_manager.send(m);
      },
    };
    const svc = new DeliveryService(hotel, { ...notifiers, general_manager: flaky }, routes, { retry: { attempts: 2, sleep: noSleep } });

    const first = await svc.deliverDay(asOf);
    expect(first.failed.length).toBeGreaterThan(0);
    expect(first.failed.every((f) => f.key.includes('|general_manager|'))).toBe(true);
    expect(notifiers.general_manager.sent).toHaveLength(0);
    expect(notifiers.operations.sent.length).toBeGreaterThan(0); // others were delivered

    broken = false;
    const retry = await svc.deliverDay(asOf);
    expect(retry.failed).toEqual([]);
    expect(retry.sent).toBe(first.failed.length); // exactly the ones that failed, nothing resent elsewhere
    expect(notifiers.operations.sent.filter((m) => m.kind === 'brief')).toHaveLength(1);
  });

  it('retries transient errors with backoff but gives up immediately on permanent ones', async () => {
    const msg: Message = { kind: 'push', role: 'finance', date: asOf, title: 't', text: 'x' };
    const delays: number[] = [];
    let transientCalls = 0;
    await expect(
      sendWithRetry({ name: 'n', send: async () => (transientCalls++, Promise.reject(new TransientDeliveryError('503'))) }, msg, { attempts: 3, baseDelayMs: 100, sleep: async (ms) => void delays.push(ms) }),
    ).rejects.toThrow('503');
    expect(transientCalls).toBe(3);
    expect(delays).toEqual([100, 200]);

    let permanentCalls = 0;
    await expect(
      sendWithRetry({ name: 'n', send: async () => (permanentCalls++, Promise.reject(new PermanentDeliveryError('404'))) }, msg, { sleep: noSleep }),
    ).rejects.toThrow('404');
    expect(permanentCalls).toBe(1);
  });
});

describe('restarts never re-notify', () => {
  it('delivery state survives a restart, and rebuilding analysis from the journal sends nothing', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'hotel-delivery-')), 'journal.jsonl');
    const journal = new FileJournal(path);
    const { hotel } = await bootstrapSimulatedHotel(undefined, { journal });
    const { notifiers, routes } = memoryRoutes();
    const now = parseTimestamp('2026-10-05 08:00', 330);
    // as in real operation, every recent day is delivered (the backfilled day before asOf is still "recent")
    const first = await new DeliveryService(hotel, notifiers, routes, { journal, retry: { sleep: noSleep } }).deliverPending(now);
    expect(first.sent).toBeGreaterThan(0);

    // --- restart ---
    const { entries } = new FileJournal(path).readAll();
    const after = new HotelIntelligence(HOTEL_MERIDIAN);
    registerStandardAdapters(after);
    const fresh = memoryRoutes();
    await after.restore(entries); // analysis replay: no notifier is even attached, and none could fire

    const resumed = new DeliveryService(after, fresh.notifiers, fresh.routes, { delivered: DeliveryService.deliveredKeys(entries) });
    const s = await resumed.deliverPending(now);
    expect(s.sent).toBe(0);
    expect(s.alreadyDelivered).toBe(first.sent);

    // control: without the recorded keys the same service WOULD send, so the assertion above means something
    const amnesiac = memoryRoutes();
    const control = await new DeliveryService(after, amnesiac.notifiers, amnesiac.routes).deliverPending(now);
    expect(control.sent).toBe(first.sent);
  }, 30_000);

  it('does not dredge up old days: only recent closed days are considered pending', async () => {
    const { hotel } = await bootstrapSimulatedHotel();
    const { notifiers, routes } = memoryRoutes();
    const svc = new DeliveryService(hotel, notifiers, routes, { lookbackDays: 2 });
    const longAfter = await svc.deliverPending(parseTimestamp('2026-12-01 08:00', 330));
    expect(longAfter.sent).toBe(0); // 120 backfilled days must not suddenly be mailed out
  }, 30_000);
});

/** A receiver we control, returning scripted status codes and recording what arrived. */
const receiver = async (statuses: number[]) => {
  const requests: { url: string; headers: Record<string, string | string[] | undefined>; body: string }[] = [];
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      requests.push({ url: req.url ?? '', headers: req.headers, body });
      res.writeHead(statuses[Math.min(requests.length - 1, statuses.length - 1)]);
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { server, requests, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/services/T0SECRET/B0SECRET` };
};

/** Awaits a promise that must reject, and returns the error (fails the test if it resolves). */
const failure = async (p: Promise<unknown>): Promise<Error> => {
  try {
    await p;
  } catch (e) {
    return e as Error;
  }
  throw new Error('expected the promise to reject');
};

describe('real HTTP notifiers', () => {
  const servers: Server[] = [];
  afterEach(() => Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r)))));
  const msg: Message = { kind: 'push', role: 'operations', date: asOf, title: '[critical] Electricity 45% above expected', text: 'details' };

  it('Slack: posts a text payload and recovers from a transient 503', async () => {
    const rx = await receiver([503, 200]);
    servers.push(rx.server);
    await sendWithRetry(new SlackNotifier('ops-slack', rx.url), msg, { sleep: noSleep });
    expect(rx.requests).toHaveLength(2);
    const payload = JSON.parse(rx.requests[1].body);
    expect(payload.text).toMatch(/Electricity 45% above expected/);
    expect(payload.text).toMatch(/details/);
  });

  it('webhook: body is HMAC-signed so the receiver can verify where it came from', async () => {
    const rx = await receiver([200]);
    servers.push(rx.server);
    await new WebhookNotifier('gateway', rx.url, 'shared-secret').send(msg);
    const { body, headers } = rx.requests[0];
    expect(JSON.parse(body)).toMatchObject({ kind: 'push', role: 'operations' });
    expect(verifyWebhookSignature(body, String(headers['x-signature']), 'shared-secret')).toBe(true);
    expect(verifyWebhookSignature(body, String(headers['x-signature']), 'wrong')).toBe(false);
  });

  it('a 4xx is permanent (not retried), and neither it nor a dead host leaks the webhook URL', async () => {
    const rx = await receiver([404]);
    servers.push(rx.server);
    const err = await failure(sendWithRetry(new SlackNotifier('ops-slack', rx.url), msg, { sleep: noSleep }));
    expect(err).toBeInstanceOf(PermanentDeliveryError);
    expect(rx.requests).toHaveLength(1);
    expect(err.message).not.toMatch(/T0SECRET|B0SECRET|127\.0\.0\.1/);

    const dead = await failure(sendWithRetry(new WebhookNotifier('gateway', 'http://127.0.0.1:1/hook/T0SECRET'), msg, { attempts: 2, sleep: noSleep }));
    expect(dead.message).toMatch(/network error or timeout/);
    expect(dead.message).not.toMatch(/T0SECRET/);
  });
});

describe('delivery config', () => {
  const ok = { notifiers: { ops: { type: 'slack', url: 'https://hooks.slack.com/services/T/B/SECRETTOKEN' } }, routes: [{ role: 'operations', notifier: 'ops' }] };

  it('builds notifiers and routes from valid config', () => {
    const { notifiers, routes } = buildDelivery(ok);
    expect(Object.keys(notifiers)).toEqual(['ops']);
    expect(routes).toEqual([{ role: 'operations', notifier: 'ops' }]);
  });

  it('rejects bad config precisely, without echoing webhook URLs', () => {
    const attempts: [unknown, RegExp][] = [
      [null, /needs "notifiers"/],
      [{ ...ok, notifiers: { ops: { type: 'slack', url: 'not a url SECRETTOKEN' } } }, /notifier "ops": url is not a valid URL/],
      [{ ...ok, notifiers: { ops: { type: 'slack', url: 'http://hooks.slack.com/services/SECRETTOKEN' } } }, /must use https/],
      [{ ...ok, notifiers: { ops: { type: 'pager', url: 'https://x.example/SECRETTOKEN' } } }, /unknown type "pager"/],
      [{ ...ok, routes: [{ role: 'janitor', notifier: 'ops' }] }, /role must be one of/],
      [{ ...ok, routes: [{ role: 'finance', notifier: 'nope' }] }, /unknown notifier "nope"/],
    ];
    for (const [cfg, re] of attempts) {
      const e = ((): Error | undefined => {
        try {
          buildDelivery(cfg);
        } catch (err) {
          return err as Error;
        }
        return undefined;
      })();
      expect(e?.message).toMatch(re);
      expect(e?.message).not.toMatch(/SECRETTOKEN/);
    }
  });
});

describe('daily cycle', () => {
  it('closes what is due, delivers it, and a repeat tick does nothing', async () => {
    const h = new HotelIntelligence(HOTEL_MERIDIAN);
    registerStandardAdapters(h);
    h.ingestObservations([{ kind: 'metric', source: 't', ts: parseTimestamp('2026-10-07 23:59', 330), metric: 'occupancy_pct', date: '2026-10-07', value: 70 }]);
    const { notifiers, routes } = memoryRoutes();
    const svc = new DeliveryService(h, notifiers, routes, { retry: { sleep: noSleep } });
    const now = parseTimestamp('2026-10-08 02:00', 330);

    const first = await runDailyCycle(h, svc, now);
    expect(first.closed).toEqual(['2026-10-07']);
    expect(first.sent).toBe(4); // a quiet day still sends each role its brief ("all normal" ≠ "system down")
    expect(notifiers.finance.sent[0].text).toMatch(/Nothing unusual/);

    expect(await runDailyCycle(h, svc, now + 60_000)).toEqual({ closed: [], sent: 0, failed: 0 });
  });
});
