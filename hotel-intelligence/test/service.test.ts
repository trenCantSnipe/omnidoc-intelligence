import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapSimulatedHotel, DEFAULT_SIM } from '../src/demo/bootstrap';
import { HOTEL_MERIDIAN } from '../src/demo/simulator';
import { registerStandardAdapters } from '../src/integration/standard';
import { signWebhook } from '../src/integration/jsonAdapters';
import { HotelIntelligence } from '../src/platform';
import { closeDueDays, createService } from '../src/service/server';
import { parseTimestamp } from '../src/util/time';

const TOKEN = 'test-token';
const SECRET = 'webhook-secret';
let hotel: HotelIntelligence;
let server: Server;
let base: string;

// Test responses are JSON we control; type them loosely rather than casting at every call site.
type Res = Omit<Response, 'json'> & { json(): Promise<any> };

const call = (path: string, init: RequestInit & { token?: string | null } = {}): Promise<Res> => {
  const { token = TOKEN, headers, ...rest } = init;
  return fetch(base + path, { ...rest, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(headers as Record<string, string>) } }) as Promise<Res>;
};

beforeAll(async () => {
  ({ hotel } = await bootstrapSimulatedHotel());
  server = createService(hotel, { apiToken: TOKEN, webhookSecrets: { 'pms.webhook': SECRET }, maxBodyBytes: 20_000 });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 30_000);

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('authentication', () => {
  it('health is open; everything else needs the bearer token', async () => {
    expect((await call('/health', { token: null })).status).toBe(200);
    expect((await call(`/briefs/${DEFAULT_SIM.asOf}`, { token: null })).status).toBe(401);
    expect((await call(`/briefs/${DEFAULT_SIM.asOf}`, { token: 'nope' })).status).toBe(401);
    expect((await call('/recommendations', { token: null })).status).toBe(401);
    // unauthenticated callers cannot probe which routes exist
    expect((await call('/no/such/route', { token: null })).status).toBe(401);
    expect((await call('/no/such/route')).status).toBe(404);
  });
});

describe('briefs and copilot', () => {
  it('serves a role-specific brief as JSON or markdown', async () => {
    const json = await (await call(`/briefs/${DEFAULT_SIM.asOf}?role=operations`)).json();
    expect(json.audience).toBe('Operations');
    expect(JSON.stringify(json.sections)).toMatch(/Electricity/);
    const md = await call(`/briefs/${DEFAULT_SIM.asOf}?format=markdown`);
    expect(md.headers.get('content-type')).toMatch(/markdown/);
    expect(await md.text()).toMatch(/Morning Intelligence Brief/);
  });

  it('validates inputs instead of guessing', async () => {
    expect((await call(`/briefs/${DEFAULT_SIM.asOf}?role=janitor`)).status).toBe(400);
    expect((await call('/briefs/yesterday')).status).toBe(400);
    expect((await call('/briefs/2030-01-01')).status).toBe(404); // not closed
    expect((await call('/ask', { method: 'POST', body: '{"question": ""}' })).status).toBe(400);
    expect((await call('/ask', { method: 'POST', body: 'not json' })).status).toBe(400);
  });

  it('answers questions', async () => {
    const r = await call('/ask', { method: 'POST', body: JSON.stringify({ question: 'What should I focus on today?' }) });
    expect(r.status).toBe(200);
    expect((await r.json()).text).toMatch(/Focus on these/);
  });
});

describe('approvals over HTTP', () => {
  it('approve executes once; a second attempt conflicts; unknown ids 404; actor is mandatory', async () => {
    const proposed = (await (await call('/recommendations?status=proposed')).json()) as { id: string; type: string }[];
    const target = proposed.find((r) => r.type === 'INVESTIGATE')!;
    expect((await call(`/recommendations/${target.id}/approve`, { method: 'POST', body: '{}' })).status).toBe(400);
    const ok = await call(`/recommendations/${target.id}/approve`, { method: 'POST', body: JSON.stringify({ actor: 'gm@meridian', note: 'ok' }) });
    expect(ok.status).toBe(200);
    expect((await ok.json()).status).toBe('executed');
    expect((await call(`/recommendations/${target.id}/approve`, { method: 'POST', body: JSON.stringify({ actor: 'gm' }) })).status).toBe(409);
    expect((await call('/recommendations/rec_nope/approve', { method: 'POST', body: JSON.stringify({ actor: 'gm' }) })).status).toBe(404);
  });

  it('rejection requires a reason', async () => {
    const other = ((await (await call('/recommendations?status=proposed')).json()) as { id: string }[])[0];
    expect((await call(`/recommendations/${other.id}/reject`, { method: 'POST', body: JSON.stringify({ actor: 'gm' }) })).status).toBe(400);
    const r = await call(`/recommendations/${other.id}/reject`, { method: 'POST', body: JSON.stringify({ actor: 'gm', reason: 'event next week' }) });
    expect((await r.json()).status).toBe('rejected');
  });
});

describe('signed webhooks', () => {
  const payload = JSON.stringify({
    event: 'reservation.created',
    occurredAt: '2026-10-05T09:00:00+05:30',
    data: { bookingId: 'WH-1', roomType: 'deluxe', total: 13000, nights: 2, channel: 'direct', arrival: '2026-10-08' },
  });
  const post = (id: string, body: string, sig: string | null) =>
    call(`/webhooks/${id}`, { method: 'POST', body, token: null, headers: sig === null ? {} : { 'x-signature': sig } });

  it('accepts a correctly signed event and treats a retry as a duplicate', async () => {
    const sig = signWebhook(payload, SECRET);
    const first = await post('pms.webhook', payload, sig);
    expect(first.status).toBe(202);
    expect((await first.json()).eventsAppended).toBe(1);
    const retry = await (await post('pms.webhook', payload, sig)).json();
    expect(retry.eventsAppended).toBe(0);
    expect(retry.duplicates).toBe(1);
  });

  it('rejects missing, wrong and tampered signatures — and stores nothing', async () => {
    const before = hotel.events.size;
    const evil = payload.replace('13000', '1');
    expect((await post('pms.webhook', payload, null)).status).toBe(401);
    expect((await post('pms.webhook', payload, 'deadbeef')).status).toBe(401);
    expect((await post('pms.webhook', evil, signWebhook(payload, SECRET))).status).toBe(401);
    expect(hotel.events.size).toBe(before);
  });

  it('fails closed for adapters with no configured secret, and never accepts the API token as a webhook credential', async () => {
    expect((await post('iot.meters', '{}', signWebhook('{}', SECRET))).status).toBe(401);
    expect((await call('/webhooks/pms.webhook', { method: 'POST', body: payload })).status).toBe(401);
  });

  it('a correctly signed but malformed payload is a precise 422, not a crash', async () => {
    const bad = JSON.stringify({ event: 'reservation.created', occurredAt: '2026-10-05T09:00:00+05:30', data: { bookingId: 'x' } });
    const r = await post('pms.webhook', bad, signWebhook(bad, SECRET));
    expect(r.status).toBe(422);
    expect((await r.json()).error).toMatch(/roomType/);
  });

  it('rejects oversized bodies', async () => {
    const big = JSON.stringify({ pad: 'x'.repeat(30_000) });
    const r = await post('pms.webhook', big, signWebhook(big, SECRET)).catch(() => null);
    // the server may reset the connection after replying; either way the body is not accepted
    if (r) expect(r.status).toBe(413);
  });
});

describe('bulk ingest and day close', () => {
  it('imports a CSV export and closes the day through the API', async () => {
    const csv = 'booking_id,timestamp,status,category,amount,nights,channel,stay_date,room_id\nCSV-1,2026-10-05 11:00,confirmed,standard,4200,1,direct,2026-10-06,';
    const imp = await call('/ingest/csv.reservations', { method: 'POST', body: csv, headers: { 'content-type': 'text/csv' } });
    expect(imp.status).toBe(202);
    expect((await imp.json()).eventsAppended).toBe(1);
    expect((await call('/ingest/csv.reservations', { method: 'POST', body: 'a,b\n1,2', headers: { 'content-type': 'text/csv' } })).status).toBe(422);
    expect((await call('/ingest/no.such', { method: 'POST', body: '{}' })).status).toBe(404);
    const closed = await call('/days/2026-10-05/close', { method: 'POST' });
    expect(closed.status).toBe(200);
    expect((await call('/briefs/2026-10-05')).status).toBe(200);
  });
});

describe('automatic day close', () => {
  const fresh = () => {
    const h = new HotelIntelligence(HOTEL_MERIDIAN);
    registerStandardAdapters(h);
    for (const d of ['2026-10-05', '2026-10-06', '2026-10-07'])
      h.ingestObservations([{ kind: 'metric', source: 't', ts: parseTimestamp(`${d} 23:59`, 330), metric: 'occupancy_pct', date: d, value: 70 }]);
    return h;
  };
  const at = (s: string) => parseTimestamp(s, 330);

  it('closes yesterday once the local clock passes the cutoff, never today, and is idempotent', async () => {
    const h = fresh();
    expect(await closeDueDays(h, at('2026-10-08 00:30'))).toEqual([]); // too early: night audit may not have run
    expect(await closeDueDays(h, at('2026-10-08 02:00'))).toEqual(['2026-10-07']);
    expect(await closeDueDays(h, at('2026-10-08 03:00'))).toEqual([]);
    expect(h.isClosed('2026-10-08')).toBe(false);
  });

  it('catches up after downtime, skipping days with no data', async () => {
    const h = fresh();
    await h.closeDay('2026-10-05');
    expect(await closeDueDays(h, at('2026-10-10 02:00'))).toEqual(['2026-10-06', '2026-10-07']); // 08, 09 had no data
  });
});
