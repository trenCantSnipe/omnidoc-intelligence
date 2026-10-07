import { signWebhook } from '../integration/jsonAdapters';
import type { Role } from '../types';

/** What gets sent. Channels render it however suits them (Slack text, JSON body, email...). */
export interface Message {
  kind: 'push' | 'inbox' | 'brief';
  role: Role;
  date: string;
  title: string;
  /** Plain markdown-ish text, readable anywhere. */
  text: string;
}

export interface Notifier {
  /** Short stable name for logs and config; never contains secrets. */
  readonly name: string;
  send(msg: Message): Promise<void>;
}

/** The receiving side said "never": retrying cannot help, so don't. */
export class PermanentDeliveryError extends Error {}
export class TransientDeliveryError extends Error {}

export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  sleep: (ms: number) => Promise<void>;
}

const DEFAULT_RETRY: RetryOptions = { attempts: 3, baseDelayMs: 500, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

/**
 * Retries transient failures (network errors, 5xx, 429) with exponential backoff. A 4xx other than
 * 429 means the request or credentials are wrong; repeating it would only hammer the receiver.
 */
export const sendWithRetry = async (n: Notifier, msg: Message, opts: Partial<RetryOptions> = {}): Promise<void> => {
  const o = { ...DEFAULT_RETRY, ...opts };
  let last: unknown;
  for (let i = 0; i < o.attempts; i++) {
    try {
      return await n.send(msg);
    } catch (e) {
      if (e instanceof PermanentDeliveryError) throw e;
      last = e;
      if (i < o.attempts - 1) await o.sleep(o.baseDelayMs * 2 ** i);
    }
  }
  throw last instanceof Error ? last : new TransientDeliveryError('delivery failed');
};

const post = async (name: string, url: string, body: string, headers: Record<string, string>): Promise<void> => {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers }, signal: AbortSignal.timeout(10_000) });
  } catch {
    // Deliberately not including the cause: fetch errors can echo the URL, and webhook URLs are secrets.
    throw new TransientDeliveryError(`${name}: network error or timeout`);
  }
  if (res.ok) return;
  const msg = `${name}: receiver returned ${res.status}`;
  throw res.status === 429 || res.status >= 500 ? new TransientDeliveryError(msg) : new PermanentDeliveryError(msg);
};

/** Slack incoming webhook. The URL is a credential: it is never logged or put in error text. */
export class SlackNotifier implements Notifier {
  constructor(
    readonly name: string,
    private url: string,
  ) {}

  async send(msg: Message): Promise<void> {
    const icon = msg.kind === 'push' ? ':rotating_light: ' : msg.kind === 'inbox' ? ':inbox_tray: ' : ':newspaper: ';
    await post(this.name, this.url, JSON.stringify({ text: `${icon}*${msg.title}*\n${msg.text}` }), {});
  }
}

/** Generic JSON webhook (WhatsApp/Teams/email gateways, internal tools), HMAC-signed so receivers can verify origin. */
export class WebhookNotifier implements Notifier {
  constructor(
    readonly name: string,
    private url: string,
    private secret?: string,
  ) {}

  async send(msg: Message): Promise<void> {
    const body = JSON.stringify(msg);
    await post(this.name, this.url, body, this.secret ? { 'x-signature': signWebhook(body, this.secret) } : {});
  }
}

/** Captures messages; for tests and dry runs. */
export class MemoryNotifier implements Notifier {
  readonly sent: Message[] = [];
  constructor(readonly name = 'memory') {}
  async send(msg: Message): Promise<void> {
    this.sent.push(msg);
  }
}
