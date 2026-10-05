import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { verifyWebhookSignature } from '../integration/jsonAdapters';
import type { HotelIntelligence } from '../platform';
import { renderBriefMarkdown } from '../briefing/dailyBrief';
import type { DateKey, Role } from '../types';
import { addDays, toDateKey } from '../util/time';

export interface ServiceConfig {
  /** Bearer token for the management API. Required; the service refuses to start without one. */
  apiToken: string;
  /** adapterId → shared secret for HMAC-signed webhooks. An adapter with no secret cannot receive webhooks. */
  webhookSecrets: Record<string, string>;
  maxBodyBytes?: number;
  /** Close yesterday once the hotel's local clock passes this hour. */
  closeAfterLocalHour?: number;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const ROLES: Role[] = ['general_manager', 'revenue_manager', 'finance', 'operations'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CATCH_UP_DAYS = 14;

/** Constant-time string comparison that does not leak length (compares fixed-size digests). */
const safeEqual = (a: string, b: string): boolean =>
  timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

const readBody = (req: IncomingMessage, limit: number): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, `body exceeds ${limit} bytes`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

const send = (res: ServerResponse, status: number, body: unknown, contentType = 'application/json'): void => {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store' });
  res.end(payload);
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'body is not valid JSON');
  }
};

const asObject = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'expected a JSON object');
  return v as Record<string, unknown>;
};

const requireString = (o: Record<string, unknown>, k: string): string => {
  const v = o[k];
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `"${k}" is required`);
  return v.trim();
};

/**
 * Closes every unclosed day that has data, up to yesterday (hotel-local), once the local clock has
 * passed `closeAfterLocalHour`. Catches up after downtime but only within a bounded window, and
 * never closes today. Safe to call as often as you like.
 */
export const closeDueDays = async (hotel: HotelIntelligence, now: number, closeAfterLocalHour = 1): Promise<DateKey[]> => {
  const tz = hotel.profile.tzOffsetMinutes;
  const localHour = new Date(now + tz * 60_000).getUTCHours();
  if (localHour < closeAfterLocalHour) return [];
  const yesterday = addDays(toDateKey(now, tz), -1);
  const earliestAllowed = addDays(yesterday, -(MAX_CATCH_UP_DAYS - 1));
  const next = hotel.asOf ? addDays(hotel.asOf, 1) : yesterday;
  const first = next < earliestAllowed ? earliestAllowed : next;
  const closed: DateKey[] = [];
  for (let d = first; d <= yesterday; d = addDays(d, 1)) {
    if (hotel.isClosed(d) || !hotel.hasData(d)) continue;
    await hotel.closeDay(d);
    closed.push(d);
  }
  return closed;
};

export const createService = (hotel: HotelIntelligence, config: ServiceConfig): Server => {
  if (!config.apiToken) throw new Error('apiToken is required');
  const limit = config.maxBodyBytes ?? 1_048_576;

  const authed = (req: IncomingMessage): void => {
    const h = req.headers.authorization ?? '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!token || !safeEqual(token, config.apiToken)) throw new HttpError(401, 'missing or invalid bearer token');
  };

  const dateParam = (s: string): DateKey => {
    if (!DATE_RE.test(s)) throw new HttpError(400, 'date must be YYYY-MM-DD');
    return s;
  };

  /** Serialises state-changing work: day-close and ingestion must not interleave. */
  let chain: Promise<unknown> = Promise.resolve();
  const exclusive = <T,>(fn: () => Promise<T> | T): Promise<T> => {
    const next = chain.then(fn); // `chain` never rejects (see below), so one failure cannot wedge the queue
    chain = next.catch(() => undefined);
    return next;
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const method = req.method ?? 'GET';

    if (method === 'GET' && url.pathname === '/health') {
      return send(res, 200, { ok: true, asOf: hotel.asOf, events: hotel.events.size });
    }

    // --- signed webhooks: authenticated by HMAC over the raw body, not by the API token ---
    if (method === 'POST' && parts[0] === 'webhooks' && parts.length === 2) {
      const adapterId = parts[1];
      const secret = config.webhookSecrets[adapterId];
      const raw = await readBody(req, limit);
      const sig = String(req.headers['x-signature'] ?? '');
      // Fail closed: no secret configured means this adapter does not accept webhooks.
      if (!secret || !verifyWebhookSignature(raw, sig, secret)) throw new HttpError(401, 'invalid webhook signature');
      const result = await exclusive(() => ingest(adapterId, parseJson(raw)));
      return send(res, 202, result);
    }

    authed(req);

    if (method === 'POST' && parts[0] === 'ingest' && parts.length === 2) {
      const raw = await readBody(req, limit);
      const isCsv = String(req.headers['content-type'] ?? '').startsWith('text/csv');
      const result = await exclusive(() => ingest(parts[1], isCsv ? raw : parseJson(raw)));
      return send(res, 202, result);
    }

    if (method === 'POST' && parts[0] === 'days' && parts[2] === 'close' && parts.length === 3) {
      const date = dateParam(parts[1]);
      const report = await exclusive(() => hotel.closeDay(date));
      return send(res, 200, { date, situations: report.situations.length, surfaced: report.surfaced.length, recommendations: report.recommendations.length });
    }

    if (method === 'GET' && parts[0] === 'briefs' && parts.length === 2) {
      const date = dateParam(parts[1]);
      const role = url.searchParams.get('role') ?? undefined;
      if (role && !ROLES.includes(role as Role)) throw new HttpError(400, `role must be one of ${ROLES.join(', ')}`);
      if (!hotel.report(date)) throw new HttpError(404, `day ${date} has not been closed`);
      const brief = hotel.brief(date, role as Role | undefined);
      return url.searchParams.get('format') === 'markdown'
        ? send(res, 200, renderBriefMarkdown(brief), 'text/markdown; charset=utf-8')
        : send(res, 200, brief);
    }

    if (method === 'POST' && url.pathname === '/ask') {
      const body = asObject(parseJson(await readBody(req, limit)));
      const answer = await hotel.ask(requireString(body, 'question'));
      return send(res, 200, { intent: answer.intent, text: answer.text });
    }

    if (method === 'GET' && url.pathname === '/recommendations') {
      const status = url.searchParams.get('status') ?? undefined;
      return send(res, 200, hotel.approvals.list(status as never));
    }

    if (method === 'POST' && parts[0] === 'recommendations' && parts.length === 3 && (parts[2] === 'approve' || parts[2] === 'reject')) {
      const body = asObject(parseJson(await readBody(req, limit)));
      const actor = requireString(body, 'actor');
      const id = parts[1];
      if (!hotel.approvals.get(id)) throw new HttpError(404, 'unknown recommendation');
      try {
        const rec = await exclusive(() =>
          parts[2] === 'approve' ? hotel.approvals.approve(id, actor, typeof body.note === 'string' ? body.note : undefined) : hotel.approvals.reject(id, actor, requireString(body, 'reason')),
        );
        return send(res, 200, rec);
      } catch (e) {
        if (e instanceof HttpError) throw e;
        throw new HttpError(409, e instanceof Error ? e.message : 'conflict');
      }
    }

    throw new HttpError(404, 'not found');
  };

  const ingest = (adapterId: string, raw: unknown) => {
    try {
      hotel.registry.get(adapterId);
    } catch {
      throw new HttpError(404, `unknown adapter ${adapterId}`);
    }
    try {
      return hotel.ingest(adapterId, raw);
    } catch (e) {
      // Bad payloads are the sender's problem: report precisely, store nothing.
      throw new HttpError(422, e instanceof Error ? e.message : 'payload rejected');
    }
  };

  return createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error('unhandled error', e);
      send(res, 500, { error: 'internal error' });
    });
  });
};
