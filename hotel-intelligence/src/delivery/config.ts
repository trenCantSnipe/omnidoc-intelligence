import type { Role } from '../types';
import { SlackNotifier, WebhookNotifier, type Notifier } from './notifier';
import type { Route } from './deliveryService';

export interface DeliveryConfig {
  notifiers: Record<string, { type: 'slack' | 'webhook'; url: string; secret?: string }>;
  routes: { role: Role; notifier: string }[];
}

const ROLES: Role[] = ['general_manager', 'revenue_manager', 'finance', 'operations'];

/**
 * Validates operator-supplied delivery config. Webhook URLs are credentials, so error messages name
 * the notifier but never include the URL or secret.
 */
export const buildDelivery = (raw: unknown): { notifiers: Record<string, Notifier>; routes: Route[] } => {
  const cfg = raw as Partial<DeliveryConfig> | null;
  if (!cfg || typeof cfg !== 'object' || !cfg.notifiers || !Array.isArray(cfg.routes)) throw new Error('delivery config needs "notifiers" (object) and "routes" (array)');
  const notifiers: Record<string, Notifier> = {};
  for (const [name, n] of Object.entries(cfg.notifiers)) {
    let url: URL;
    try {
      url = new URL(n.url);
    } catch {
      throw new Error(`notifier "${name}": url is not a valid URL`);
    }
    if (n.type === 'slack') {
      if (url.protocol !== 'https:') throw new Error(`notifier "${name}": Slack webhooks must use https`);
      notifiers[name] = new SlackNotifier(name, n.url);
    } else if (n.type === 'webhook') {
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`notifier "${name}": url must be http(s)`);
      notifiers[name] = new WebhookNotifier(name, n.url, n.secret);
    } else throw new Error(`notifier "${name}": unknown type "${String((n as { type: unknown }).type)}"`);
  }
  const routes = cfg.routes.map((r, i) => {
    if (!ROLES.includes(r.role)) throw new Error(`route ${i}: role must be one of ${ROLES.join(', ')}`);
    if (!notifiers[r.notifier]) throw new Error(`route ${i}: unknown notifier "${r.notifier}"`);
    return { role: r.role, notifier: r.notifier };
  });
  return { notifiers, routes };
};
