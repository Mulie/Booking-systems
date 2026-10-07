import { DateTime } from "luxon";
import type { PoolClient } from "pg";
import { pool } from "./db";
import { ApiError } from "./errors";
import {
  collapseForAnyBarber,
  computeSlots,
  type BarberInput,
  type DaySlots,
  type Slot,
} from "./availability";
import { fetchBusy } from "./google";

export type Shop = {
  id: string;
  name: string;
  timezone: string;
  address: string;
  phone: string;
  cancellation_policy: string;
  slot_increment_min: number;
  min_lead_min: number;
  horizon_days: number;
  cancel_cutoff_hours: number;
};

type Db = Pick<PoolClient, "query">;

export async function getShop(db: Db, shopId: string): Promise<Shop> {
  const r = await db.query("SELECT * FROM shops WHERE id=$1", [shopId]);
  if (!r.rows[0]) throw new ApiError(404, "Shop not found");
  return r.rows[0];
}

export async function getDefaultShopId(): Promise<string> {
  const r = await pool().query("SELECT id FROM shops ORDER BY created_at LIMIT 1");
  if (!r.rows[0]) throw new ApiError(404, "Shop is not configured");
  return r.rows[0].id;
}

export type ServiceRow = {
  id: string;
  name: string;
  description: string;
  duration_min: number;
  buffer_min: number;
  price: string;
  active: boolean;
};

export async function getActiveService(db: Db, shopId: string, serviceId: string): Promise<ServiceRow> {
  const r = await db.query("SELECT * FROM services WHERE id=$1 AND shop_id=$2", [serviceId, shopId]);
  const s = r.rows[0];
  if (!s) throw new ApiError(404, "Service not found");
  if (!s.active) throw new ApiError(422, "This service is no longer available");
  return s;
}

export type LoadOpts = {
  barberId?: string | "any";
  excludeBookingId?: string;
  includeBusy?: boolean; // Google freebusy (network); skipped inside booking transactions
  rangeStart: number;
  rangeEnd: number;
};

/** Load everything the pure engine needs. Only active barbers who perform the service are eligible. */
export async function loadBarberInputs(
  db: Db,
  shop: Shop,
  serviceId: string,
  o: LoadOpts,
): Promise<BarberInput[]> {
  const params: unknown[] = [shop.id, serviceId];
  let filter = "";
  if (o.barberId && o.barberId !== "any") {
    params.push(o.barberId);
    filter = "AND b.id = $3";
  }
  const barbers = (
    await db.query(
      `SELECT b.id, b.display_name, b.buffer_min, b.google_calendar_id, b.google_busy_sync
         FROM barbers b
         JOIN barber_services bs ON bs.barber_id=b.id AND bs.service_id=$2 AND bs.active
        WHERE b.shop_id=$1 AND b.active ${filter}
        ORDER BY b.display_name`,
      params,
    )
  ).rows;
  if (!barbers.length) return [];
  const ids = barbers.map((b) => b.id);
  const from = new Date(o.rangeStart).toISOString();
  const to = new Date(o.rangeEnd).toISOString();

  const rules = await db.query(
      `SELECT barber_id, weekday, start_minute, end_minute, effective_from::text AS ef, effective_to::text AS et
         FROM availability_rules WHERE barber_id = ANY($1)`,
      [ids],
    );
  const off = await db.query(
      `SELECT barber_id, starts_at, ends_at FROM time_off
        WHERE barber_id = ANY($1) AND starts_at < $3 AND ends_at > $2`,
      [ids, from, to],
    );
  const bookings = await db.query(
      `SELECT barber_id, starts_at, blocked_until FROM bookings
        WHERE barber_id = ANY($1) AND status IN ('PENDING','CONFIRMED')
          AND starts_at < $3 AND blocked_until > $2
          AND ($4::uuid IS NULL OR id <> $4)`,
      [ids, from, to, o.excludeBookingId ?? null],
    );

  const busyByBarber = new Map<string, { start: number; end: number }[]>();
  if (o.includeBusy) {
    await Promise.all(
      barbers
        .filter((b) => b.google_busy_sync && b.google_calendar_id)
        .map(async (b) => {
          busyByBarber.set(b.id, await fetchBusy(shop.id, b.google_calendar_id, o.rangeStart, o.rangeEnd));
        }),
    );
  }

  // Our own calendar event for the booking being rescheduled must not block its new time.
  let own: { start: number; end: number } | null = null;
  if (o.excludeBookingId) {
    const x = (await db.query("SELECT starts_at, blocked_until FROM bookings WHERE id=$1", [o.excludeBookingId])).rows[0];
    if (x) own = { start: +new Date(x.starts_at) - 60_000, end: +new Date(x.blocked_until) + 60_000 };
  }
  const notOwn = (i: { start: number; end: number }) => !(own && i.start >= own.start && i.end <= own.end);

  return barbers.map((b) => ({
    id: b.id,
    name: b.display_name,
    bufferMin: b.buffer_min,
    rules: rules.rows
      .filter((r) => r.barber_id === b.id)
      .map((r) => ({
        weekday: r.weekday,
        startMinute: r.start_minute,
        endMinute: r.end_minute,
        effectiveFrom: r.ef,
        effectiveTo: r.et,
      })),
    timeOff: off.rows
      .filter((r) => r.barber_id === b.id)
      .map((r) => ({ start: +new Date(r.starts_at), end: +new Date(r.ends_at) })),
    bookings: bookings.rows
      .filter((r) => r.barber_id === b.id)
      .map((r) => ({ start: +new Date(r.starts_at), end: +new Date(r.blocked_until) })),
    busy: (busyByBarber.get(b.id) ?? []).filter(notOwn),
  }));
}

export type SlotQuery = {
  shop: Shop;
  service: ServiceRow;
  barberId: string | "any";
  fromDate: string;
  toDate: string;
  now?: number;
  excludeBookingId?: string;
  includeBusy?: boolean;
  /** Admin overrides: skip lead-time/horizon (manual bookings). */
  ignoreWindow?: boolean;
};

/** Per-barber slots (not collapsed). */
export async function findSlots(db: Db, q: SlotQuery): Promise<DaySlots[]> {
  const { shop } = q;
  const now = q.now ?? Date.now();
  const rangeStart = DateTime.fromISO(q.fromDate, { zone: shop.timezone }).startOf("day").toMillis();
  const rangeEnd = DateTime.fromISO(q.toDate, { zone: shop.timezone }).endOf("day").toMillis();
  const barbers = await loadBarberInputs(db, shop, q.service.id, {
    barberId: q.barberId,
    excludeBookingId: q.excludeBookingId,
    includeBusy: q.includeBusy,
    rangeStart: rangeStart - 86_400_000,
    rangeEnd: rangeEnd + 86_400_000,
  });
  return computeSlots({
    timezone: shop.timezone,
    fromDate: q.fromDate,
    toDate: q.toDate,
    durationMin: q.service.duration_min,
    serviceBufferMin: q.service.buffer_min,
    incrementMin: shop.slot_increment_min,
    minLeadMin: q.ignoreWindow ? -10_000_000 : shop.min_lead_min,
    horizonDays: q.ignoreWindow ? 3650 : shop.horizon_days,
    now,
    barbers,
  });
}

/** Number of active bookings per barber in a range, used to pick the least-loaded barber for "any". */
export async function barberLoad(db: Db, barberIds: string[], from: number, to: number): Promise<Map<string, number>> {
  const r = await db.query(
    `SELECT barber_id, count(*)::int AS n FROM bookings
      WHERE barber_id = ANY($1) AND status IN ('PENDING','CONFIRMED') AND starts_at >= $2 AND starts_at < $3
      GROUP BY barber_id`,
    [barberIds, new Date(from).toISOString(), new Date(to).toISOString()],
  );
  return new Map(r.rows.map((x) => [x.barber_id, x.n]));
}

/** Customer-facing availability: validates the range, collapses "any", clamps to the booking horizon. */
export async function publicAvailability(
  db: Db,
  shopId: string,
  serviceId: string,
  barberId: string | "any",
  fromDate: string,
  toDate: string,
  excludeBookingId?: string,
) {
  const shop = await getShop(db, shopId);
  const service = await getActiveService(db, shopId, serviceId);
  const today = DateTime.now().setZone(shop.timezone).startOf("day");
  let from = DateTime.fromISO(fromDate, { zone: shop.timezone });
  let to = DateTime.fromISO(toDate, { zone: shop.timezone });
  if (!from.isValid || !to.isValid || to < from) throw new ApiError(400, "Invalid date range");
  if (from < today) from = today;
  const last = today.plus({ days: shop.horizon_days });
  if (to > last) to = last;
  if (to.diff(from, "days").days > 62) throw new ApiError(400, "Date range too large");
  if (to < from) return { timezone: shop.timezone, dates: [] as any[] };

  let days = await findSlots(db, {
    shop,
    service,
    barberId,
    fromDate: from.toISODate()!,
    toDate: to.toISODate()!,
    includeBusy: true,
    excludeBookingId,
  });
  if (barberId === "any") {
    const ids = [...new Set(days.flatMap((d) => d.slots.map((s) => s.barberId)))];
    const load = ids.length
      ? await barberLoad(db, ids, from.toMillis(), to.endOf("day").toMillis())
      : new Map<string, number>();
    days = collapseForAnyBarber(days, load);
  }
  const fmt = (s: Slot) => ({
    start: s.start,
    startsAt: new Date(s.startsAt).toISOString(),
    barberId: s.barberId,
    barberName: s.barberName,
  });
  return { timezone: shop.timezone, dates: days.map((d) => ({ date: d.date, slots: d.slots.map(fmt) })) };
}
