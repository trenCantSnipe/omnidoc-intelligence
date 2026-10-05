import { dailyReportCsvAdapter, inventoryCsvAdapter, rateShopCsvAdapter, reservationsCsvAdapter } from '../integration/csvAdapters';
import { meterAdapter, pmsWebhookAdapter, rateShopJsonAdapter } from '../integration/jsonAdapters';
import { HotelIntelligence, type PlatformOptions } from '../platform';
import { addDays } from '../util/time';
import { simulateHotel, type SimOptions, type SimData } from './simulator';

export const DEFAULT_SIM: SimOptions = { asOf: '2026-10-04', historyDays: 120, seed: 42, scenario: true };

/** Registers the adapters a typical hotel would use. A new PMS means adding one more `register` call. */
export const registerStandardAdapters = (hotel: HotelIntelligence): void => {
  hotel.registry
    .register(reservationsCsvAdapter())
    .register(
      dailyReportCsvAdapter('csv.daily_report', 'date', {
        occupancy_pct: 'occupancy_pct',
        revenue: 'revenue',
        electricity_kwh: 'electricity_kwh',
        water_kl: 'water_kl',
        maintenance_cost: 'maintenance_cost',
        staff_cost: 'staff_cost',
        expenses: 'expenses',
        fnb_wastage: 'fnb_wastage',
      }),
    )
    .register(rateShopCsvAdapter())
    .register(inventoryCsvAdapter())
    .register(pmsWebhookAdapter())
    .register(meterAdapter())
    .register(rateShopJsonAdapter());
};

/**
 * Onboards a (simulated) hotel the way a real one would be onboarded: bulk-import history through
 * the adapters, replay it to learn baselines, then process the latest day from live feeds.
 */
export const bootstrapSimulatedHotel = async (
  sim: SimData = simulateHotel(DEFAULT_SIM),
  platformOpts: PlatformOptions = {},
): Promise<{ hotel: HotelIntelligence; sim: SimData }> => {
  const hotel = new HotelIntelligence(sim.profile, platformOpts);
  registerStandardAdapters(hotel);

  // 1. history
  hotel.ingest('csv.reservations', sim.history.reservationsCsv);
  hotel.ingest('csv.daily_report', sim.history.dailyReportCsv);
  hotel.ingest('csv.rate_shop', sim.history.rateShopCsv);
  hotel.ingest('csv.inventory', sim.history.inventoryCsv);
  hotel.ingestObservations(sim.history.promotions);

  // 2. replay history so baselines, memory and alert cooldowns exist
  await hotel.backfill(sim.start, addDays(sim.asOf, -1));

  // 3. the latest day arrives through live integrations
  for (const w of sim.live.webhooks) hotel.ingest('pms.webhook', w);
  for (const m of sim.live.meterReadings) hotel.ingest('iot.meters', m);
  hotel.ingest('feed.rate_shop', sim.live.rateShop);
  hotel.ingest('csv.daily_report', sim.live.dailyReportCsv);
  await hotel.closeDay(sim.asOf);
  return { hotel, sim };
};
