import type { DateKey } from './util/time';

export type { DateKey };

/* ------------------------------------------------------------------ *
 * Hotel profile
 * ------------------------------------------------------------------ */

export interface RoomCategory {
  id: string;
  name: string;
  totalRooms: number;
  /** Premium categories drive pricing opportunities. */
  premium: boolean;
  baseRate: number;
  /** Pricing guardrails used by the decision engine. */
  minRate: number;
  maxRate: number;
}

export interface Competitor {
  id: string;
  name: string;
}

export interface HotelProfile {
  id: string;
  name: string;
  currency: string;
  /** Minutes east of UTC (IST = 330). */
  tzOffsetMinutes: number;
  categories: RoomCategory[];
  competitors: Competitor[];
  /** Holidays / local events by date; flags days where "normal" differs. */
  calendar: Record<DateKey, string>;
  /** Used to cost electricity anomalies. */
  energyTariffPerKwh: number;
  /** Bookings at or above this amount are surfaced individually. */
  largeBookingAmount: number;
}

export const totalRooms = (p: HotelProfile): number => p.categories.reduce((s, c) => s + c.totalRooms, 0);

/* ------------------------------------------------------------------ *
 * Observations: the normalized output of integration adapters.
 * Everything a source system can tell us reduces to one of these.
 * ------------------------------------------------------------------ */

interface ObservationBase {
  /** Epoch ms when the source says this was true. */
  ts: number;
  /** Adapter id, kept for lineage. */
  source: string;
}

export interface RateObservation extends ObservationBase {
  kind: 'rate';
  party: 'own_direct' | 'own_ota' | 'competitor';
  /** OTA name or competitor id. */
  provider?: string;
  category: string;
  roomId?: string;
  price: number;
}

export interface InventoryObservation extends ObservationBase {
  kind: 'inventory';
  category: string;
  stayDate: DateKey;
  total: number;
  available: number;
}

export interface PromotionObservation extends ObservationBase {
  kind: 'promotion';
  promoId: string;
  name: string;
  active: boolean;
  discountPct?: number;
}

export interface BookingObservation extends ObservationBase {
  kind: 'booking';
  bookingId: string;
  status: 'confirmed' | 'cancelled';
  category: string;
  roomId?: string;
  amount: number;
  nights: number;
  channel: string;
  stayDate: DateKey;
}

export interface MetricObservation extends ObservationBase {
  kind: 'metric';
  metric: string;
  date: DateKey;
  value: number;
  /** `add` accumulates interval readings (IoT meters); default `set`. */
  mode?: 'set' | 'add';
}

export type Observation =
  | RateObservation
  | InventoryObservation
  | PromotionObservation
  | BookingObservation
  | MetricObservation;

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

export type EventType =
  | 'ROOM_BOOKED'
  | 'ROOM_CANCELLED'
  | 'PRICE_CHANGED'
  | 'OCCUPANCY_CHANGED'
  | 'INVENTORY_CHANGED'
  | 'COMPETITOR_PRICE_CHANGED'
  | 'PROMOTION_STARTED'
  | 'PROMOTION_ENDED'
  | 'ELECTRICITY_SPIKE'
  | 'REVENUE_ANOMALY'
  | 'CANCELLATION_SPIKE'
  | 'EXPENSE_ANOMALY'
  | 'ROOM_CATEGORY_SELLING_FAST'
  | 'ROOM_CATEGORY_SELLING_SLOW'
  | 'METRIC_ANOMALY';

export type Significance = 'noise' | 'minor' | 'notable' | 'major';

export const SIGNIFICANCE_RANK: Record<Significance, number> = { noise: 0, minor: 1, notable: 2, major: 3 };

export type Scalar = string | number | boolean | null;

export interface HotelEvent {
  id: string;
  hotelId: string;
  type: EventType;
  ts: number;
  date: DateKey;
  source: string;
  payload: Record<string, Scalar>;
  /** Whether this event deserves to be looked at. Raw events are stored regardless. */
  significance: Significance;
  reasons: string[];
}

/* ------------------------------------------------------------------ *
 * Baselines & anomalies
 * ------------------------------------------------------------------ */

export type Domain = 'revenue' | 'demand' | 'pricing' | 'market' | 'cancellations' | 'operations' | 'finance';

export interface Expectation {
  expected: number;
  /** Standard deviation, in log units when `scale` is 'log'. */
  sigma: number;
  scale: 'linear' | 'log';
  lower: number;
  upper: number;
  method: 'seasonal' | 'seasonal-special' | 'regression';
  /** Number of historical points the baseline is built on. */
  n: number;
  confidence: number;
  drivers: { name: string; coef: number }[];
  notes: string[];
}

export type AnomalyClass = 'actionable' | 'watch' | 'normal' | 'insufficient_baseline';

export interface Anomaly {
  id: string;
  hotelId: string;
  metric: string;
  label: string;
  unit: string;
  date: DateKey;
  observed: number;
  expected: number;
  lower: number;
  upper: number;
  z: number;
  deviationPct: number;
  direction: 'up' | 'down';
  classification: AnomalyClass;
  favorable: boolean | null;
  method: Expectation['method'];
  confidence: number;
  drivers: Expectation['drivers'];
  notes: string[];
  domains: Domain[];
}

/* ------------------------------------------------------------------ *
 * Situations, recommendations, alerts
 * ------------------------------------------------------------------ */

export type SituationKind =
  | 'demand_surge'
  | 'demand_softness'
  | 'market_move'
  | 'price_undercut'
  | 'rate_parity_gap'
  | 'energy_inefficiency'
  | 'revenue_deviation'
  | 'cancellation_spike'
  | 'cost_anomaly';

export interface Signal {
  label: string;
  evidence: string;
  weight: number;
}

export interface Situation {
  id: string;
  hotelId: string;
  date: DateKey;
  kind: SituationKind;
  domains: Domain[];
  title: string;
  /** Human-readable, number-backed explanation built from facts (not from an LLM). */
  summary: string;
  confidence: number;
  signals: Signal[];
  category?: string;
  metric?: string;
  /** Key numbers the narrative is built on. */
  facts: Record<string, number | string>;
  /** Estimated money at stake (positive = opportunity or loss magnitude). */
  impactAmount?: number;
  impactBasis?: string;
  /** Statistical strength 0..1, used by importance ranking. */
  severity: number;
  /** Whether the situation is an opportunity or a problem. */
  polarity: 'opportunity' | 'problem' | 'neutral';
  urgency: 'now' | 'today' | 'this_week' | 'fyi';
  eventIds: string[];
  anomalyIds: string[];
}

export type RecommendationType =
  | 'ADJUST_PRICE'
  | 'FIX_RATE_PARITY'
  | 'LAUNCH_PROMOTION'
  | 'INVESTIGATE';

export type RecommendationStatus = 'proposed' | 'approved' | 'rejected' | 'executed' | 'auto_executed' | 'failed';

export interface Recommendation {
  id: string;
  hotelId: string;
  situationId: string;
  createdForDate: DateKey;
  type: RecommendationType;
  title: string;
  rationale: string;
  /** Machine-readable action parameters (category, pct range, prices...). */
  params: Record<string, Scalar>;
  expectedImpact?: { amount: number; basis: string };
  risk: 'low' | 'medium' | 'high';
  confidence: number;
  guardrails: string[];
  requiresApproval: boolean;
  status: RecommendationStatus;
  domains: Domain[];
}

export type Tier = 'critical' | 'important' | 'informational' | 'noise';

export interface Alert {
  id: string;
  hotelId: string;
  date: DateKey;
  tier: Tier;
  score: number;
  title: string;
  body: string;
  domains: Domain[];
  situationId: string;
  recommendationIds: string[];
  dedupeKey: string;
  /** How long a repeat of the same issue is held back unless it escalates. */
  cooldownDays: number;
}

export type Role = 'general_manager' | 'revenue_manager' | 'finance' | 'operations';

export type Delivery = 'push' | 'inbox' | 'daily_brief';

export interface RoutedAlert {
  alert: Alert;
  role: Role;
  delivery: Delivery;
}

/* ------------------------------------------------------------------ *
 * Day report: everything the platform concluded when a day was closed
 * ------------------------------------------------------------------ */

export interface DayReport {
  date: DateKey;
  /** Every metric evaluated, including the normal ones (they power KPI lines and "is this normal?" answers). */
  evaluations: Anomaly[];
  situations: Situation[];
  recommendations: Recommendation[];
  /** All scored alerts, before throttling. */
  alerts: Alert[];
  /** Alerts actually surfaced to people (noise and repeats removed). */
  surfaced: Alert[];
  suppressed: { noise: number; repeats: number };
  /** Notable raw events of the day (price moves, competitor moves, promotions...). */
  notableEvents: HotelEvent[];
}
