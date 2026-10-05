import type { Domain, EventType, HotelProfile } from '../types';

/**
 * Per-metric knowledge: what counts as an operationally meaningful deviation, which direction
 * is problematic, and which other metrics explain it. This is the "domain model" that turns
 * generic statistics into hotel-specific judgement.
 */
export interface MetricSpec {
  id: string;
  label: string;
  unit: string;
  domains: Domain[];
  /** Topic used by the copilot to match questions ("electricity", "water"...). */
  topic: string;
  /** Which direction of deviation can be actionable. The other direction is capped at "watch". */
  surface: 'both' | 'up' | 'down';
  /** Which direction is good for the business; null when neither is inherently good. */
  goodDirection: 'up' | 'down' | null;
  /** Minimum relative deviation to be operationally significant (0.1 = 10%). */
  minRelEffect: number;
  /** Optional minimum absolute deviation, in the metric's unit. */
  minAbsEffect?: number;
  sigmaFloorPct?: number;
  sigmaFloorAbs?: number;
  /** Count-like metrics get Poisson noise as a variance floor. */
  poisson?: boolean;
  /** Same-day metrics that explain this one (e.g. electricity ~ occupancy). */
  covariates: string[];
  eventType: EventType;
  /** Minimum days of history before we will pass judgement. */
  minHistory: number;
  /** Model log(value): for heavy-tailed positive series such as lumpy maintenance bills. */
  logScale?: boolean;
  /** False for KPIs that are shown but must never raise an alert on their own. */
  alerting?: boolean;
}

const base = (s: Partial<MetricSpec> & Pick<MetricSpec, 'id' | 'label' | 'unit' | 'domains' | 'topic'>): MetricSpec => ({
  surface: 'both',
  goodDirection: null,
  minRelEffect: 0.15,
  covariates: [],
  eventType: 'METRIC_ANOMALY',
  minHistory: 21,
  ...s,
});

export const METRIC_SPECS: Record<string, MetricSpec> = {
  revenue: base({
    id: 'revenue', label: 'Revenue', unit: '₹', domains: ['revenue', 'finance'], topic: 'revenue',
    goodDirection: 'up', minRelEffect: 0.1, sigmaFloorPct: 0.05, eventType: 'REVENUE_ANOMALY',
  }),
  occupancy_pct: base({
    id: 'occupancy_pct', label: 'Occupancy', unit: '%', domains: ['demand'], topic: 'occupancy',
    goodDirection: 'up', minRelEffect: 0.08, sigmaFloorAbs: 3,
  }),
  bookings: base({
    id: 'bookings', label: 'New bookings', unit: 'bookings', domains: ['demand'], topic: 'bookings',
    goodDirection: 'up', minRelEffect: 0.25, poisson: true,
  }),
  // Alerting is done on the cancellation *count given today's bookings* (a Poisson-style test that
  // knows a 20-booking day is noisier than a 60-booking day). The rate is a KPI shown alongside it.
  cancellations: base({
    id: 'cancellations', label: 'Cancellations', unit: 'cancellations', domains: ['cancellations', 'revenue'], topic: 'cancellations',
    surface: 'up', goodDirection: 'down', minRelEffect: 0.5, poisson: true, minAbsEffect: 3, covariates: ['bookings'], eventType: 'CANCELLATION_SPIKE',
  }),
  cancellation_rate: base({
    id: 'cancellation_rate', label: 'Cancellation rate', unit: '%', domains: ['cancellations', 'revenue'], topic: 'cancellations',
    surface: 'up', goodDirection: 'down', minRelEffect: 0.4, minAbsEffect: 5, sigmaFloorAbs: 2.5, alerting: false,
  }),
  adr: base({
    id: 'adr', label: 'Average daily rate', unit: '₹', domains: ['pricing', 'revenue'], topic: 'adr',
    goodDirection: 'up', minRelEffect: 0.08, sigmaFloorPct: 0.03,
  }),
  electricity_kwh: base({
    id: 'electricity_kwh', label: 'Electricity consumption', unit: 'kWh', domains: ['operations'], topic: 'electricity',
    surface: 'up', goodDirection: 'down', minRelEffect: 0.12, sigmaFloorPct: 0.04, covariates: ['rooms_sold'], eventType: 'ELECTRICITY_SPIKE',
  }),
  water_kl: base({
    id: 'water_kl', label: 'Water consumption', unit: 'kL', domains: ['operations'], topic: 'water',
    surface: 'up', goodDirection: 'down', minRelEffect: 0.15, sigmaFloorPct: 0.05, covariates: ['rooms_sold'],
  }),
  maintenance_cost: base({
    id: 'maintenance_cost', label: 'Maintenance cost', unit: '₹', domains: ['operations', 'finance'], topic: 'maintenance',
    surface: 'up', goodDirection: 'down', minRelEffect: 0.5, sigmaFloorPct: 0.2, logScale: true,
  }),
  staff_cost: base({
    id: 'staff_cost', label: 'Staffing cost', unit: '₹', domains: ['operations', 'finance'], topic: 'staffing',
    surface: 'up', goodDirection: 'down', minRelEffect: 0.12, sigmaFloorPct: 0.04, covariates: ['rooms_sold'],
  }),
  expenses: base({
    id: 'expenses', label: 'Operating expenses', unit: '₹', domains: ['finance'], topic: 'expenses',
    surface: 'up', goodDirection: 'down', minRelEffect: 0.2, sigmaFloorPct: 0.08, eventType: 'EXPENSE_ANOMALY',
  }),
  fnb_wastage: base({
    id: 'fnb_wastage', label: 'F&B wastage', unit: 'kg', domains: ['operations'], topic: 'food and beverage',
    surface: 'up', goodDirection: 'down', minRelEffect: 0.3, sigmaFloorPct: 0.1, covariates: ['rooms_sold'],
  }),
};

export const PICKUP_PREFIX = 'pickup:';

export const specFor = (metric: string, profile: HotelProfile): MetricSpec | undefined => {
  if (METRIC_SPECS[metric]) return METRIC_SPECS[metric];
  if (metric.startsWith(PICKUP_PREFIX)) {
    const cat = profile.categories.find((c) => c.id === metric.slice(PICKUP_PREFIX.length));
    if (!cat) return undefined;
    return base({
      id: metric, label: `${cat.name} booking pace`, unit: 'bookings', domains: ['demand', 'pricing'], topic: `${cat.name.toLowerCase()} pickup`,
      goodDirection: 'up', minRelEffect: 0.35, poisson: true, minHistory: 28,
    });
  }
  return undefined;
};

/** Metrics the anomaly engine evaluates at day close. */
export const evaluatedMetrics = (profile: HotelProfile): string[] => [
  ...Object.keys(METRIC_SPECS),
  ...profile.categories.map((c) => `${PICKUP_PREFIX}${c.id}`),
];
