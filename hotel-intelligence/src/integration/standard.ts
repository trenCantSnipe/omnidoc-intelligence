import type { HotelIntelligence } from '../platform';
import { dailyReportCsvAdapter, inventoryCsvAdapter, rateShopCsvAdapter, reservationsCsvAdapter } from './csvAdapters';
import { meterAdapter, pmsWebhookAdapter, rateShopJsonAdapter } from './jsonAdapters';

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
