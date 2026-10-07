import { DateTime } from "luxon";
import type { PoolClient } from "pg";
import { pool, tx } from "./db";
import { ApiError } from "./errors";
import { enqueue } from "./jobs";
import { barberLoad, findSlots, getActiveService, getShop, loadBarberInputs, type Shop } from "./slots";
import { env } from "./env";

type Db = Pick<PoolClient, "query">;
const MIN = 60_000;

export type BookingView = {
  id: string;
  shopId: string;
  manageToken: string;
  status: string;
  source: string;
  startsAt: Date;
  endsAt: Date;
  durationMin: number;
  price: string;
  serviceId: string;
  serviceName: string;
  barberId: string;
  barberName: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  calendarId: string | null;
  calendarSyncStatus: string;
  shopName: string;
  shopAddress: string;
  shopPhone: string;
  timezone: string;
  cancellationPolicy: string;
  cancelCutoffHours: number;
};

export async function loadBookingView(db: Db, id: string, lock = false): Promise<BookingView | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const r = await db.query(
    `SELECT b.*, s.name AS service_name, br.display_name AS barber_name, br.google_calendar_id,
            c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
            sh.name AS shop_name, sh.address, sh.phone AS shop_phone, sh.timezone,
            sh.cancellation_policy, sh.cancel_cutoff_hours
       FROM bookings b
       JOIN services s ON s.id=b.service_id JOIN barbers br ON br.id=b.barber_id
       JOIN customers c ON c.id=b.customer_id JOIN shops sh ON sh.id=b.shop_id
      WHERE b.id=$1 ${lock ? "FOR UPDATE OF b" : ""}`,
    [id],
  );
  const x = r.rows[0];
  if (!x) return null;
  return {
    id: x.id,
    shopId: x.shop_id,
    manageToken: x.manage_token,
    status: x.status,
    source: x.source,
    startsAt: x.starts_at,
    endsAt: x.ends_at,
    durationMin: x.duration_min,
    price: x.price,
    serviceId: x.service_id,
    serviceName: x.service_name,
    barberId: x.barber_id,
    barberName: x.barber_name,
    customerName: x.customer_name,
    customerPhone: x.customer_phone,
    customerEmail: x.customer_email,
    calendarId: x.google_calendar_id,
    calendarSyncStatus: x.calendar_sync_status,
    shopName: x.shop_name,
    shopAddress: x.address,
    shopPhone: x.shop_phone,
    timezone: x.timezone,
    cancellationPolicy: x.cancellation_policy,
    cancelCutoffHours: x.cancel_cutoff_hours,
  };
}

export function publicBooking(b: BookingView) {
  return {
    id: b.id,
    status: b.status,
    startsAt: b.startsAt.toISOString(),
    endsAt: b.endsAt.toISOString(),
    timezone: b.timezone,
    service: { id: b.serviceId, name: b.serviceName, durationMin: b.durationMin, price: b.price },
    barber: { id: b.barberId, name: b.barberName },
    customer: { name: b.customerName },
    shop: { name: b.shopName, address: b.shopAddress, phone: b.shopPhone, cancellationPolicy: b.cancellationPolicy },
    canModify:
      ["CONFIRMED", "PENDING"].includes(b.status) &&
      +b.startsAt - Date.now() >= b.cancelCutoffHours * 3600_000,
  };
}

export const normalizePhone = (raw: string) => {
  const plus = raw.trim().startsWith("+");
  const digits = raw.replace(/\D/g, "");
  return (plus ? "+" : digits.length === 10 ? "+1" : "+") + digits;
};

async function logEvent(db: Db, bookingId: string, type: string, actor: string, metadata: object = {}) {
  await db.query("INSERT INTO booking_events(booking_id,event_type,actor,metadata) VALUES ($1,$2,$3,$4)", [
    bookingId,
    type,
    actor,
    JSON.stringify(metadata),
  ]);
}

async function logFailure(shopId: string, reason: string, detail: object) {
  await pool()
    .query("INSERT INTO booking_failures(shop_id,reason,detail) VALUES ($1,$2,$3)", [shopId, reason, JSON.stringify(detail)])
    .catch(() => {});
}

function checkWindow(shop: Shop, startsAt: number, now: number) {
  if (startsAt < now) throw new ApiError(422, "You can't book a time in the past");
  if (startsAt < now + shop.min_lead_min * MIN)
    throw new ApiError(422, `Appointments need at least ${Math.round(shop.min_lead_min / 60 * 10) / 10} hours' notice`);
  const horizonEnd = DateTime.fromMillis(now, { zone: shop.timezone }).plus({ days: shop.horizon_days }).endOf("day").toMillis();
  if (startsAt > horizonEnd) throw new ApiError(422, `Bookings open up to ${shop.horizon_days} days ahead`);
}

/** Barbers whose Google Calendar shows a conflicting busy event (network call; done before the DB transaction). */
async function externalConflicts(shop: Shop, serviceId: string, barberId: string, startsAt: number, endsAt: number, excludeBookingId?: string) {
  const inputs = await loadBarberInputs(pool(), shop, serviceId, {
    barberId,
    includeBusy: true,
    excludeBookingId,
    rangeStart: startsAt,
    rangeEnd: endsAt,
  });
  return new Set(inputs.filter((b) => b.busy.some((i) => i.start < endsAt && i.end > startsAt)).map((b) => b.id));
}

export type CreateInput = {
  shopId: string;
  serviceId: string;
  barberId: string | "any";
  startsAt: Date;
  customer: { name: string; phone: string; email?: string | null };
  idempotencyKey?: string;
  source?: "WEBSITE" | "ADMIN" | "GOOGLE" | "OTHER";
  actor?: string;
  ignoreWindow?: boolean;
  now?: number;
};

export async function createBooking(i: CreateInput): Promise<BookingView> {
  const now = i.now ?? Date.now();
  const shop = await getShop(pool(), i.shopId);
  const service = await getActiveService(pool(), i.shopId, i.serviceId);
  const actor = i.actor ?? "customer";
  const t = i.startsAt.getTime();

  if (i.idempotencyKey) {
    const ex = await pool().query("SELECT id FROM bookings WHERE shop_id=$1 AND idempotency_key=$2", [
      i.shopId,
      i.idempotencyKey,
    ]);
    if (ex.rows[0]) return (await loadBookingView(pool(), ex.rows[0].id))!;
  }
  if (!i.ignoreWindow) checkWindow(shop, t, now);

  const date = DateTime.fromMillis(t, { zone: shop.timezone }).toISODate()!;
  const needMs = (service.duration_min + service.buffer_min) * MIN;
  const busyBarbers = await externalConflicts(shop, service.id, i.barberId, t, t + needMs);

  try {
    return await tx(async (db) => {
      // Serialise concurrent bookings per barber; the exclusion constraint is the final backstop.
      const locked = await db.query(
        `SELECT b.id FROM barbers b JOIN barber_services bs ON bs.barber_id=b.id AND bs.service_id=$2 AND bs.active
          WHERE b.shop_id=$1 AND b.active AND ($3::text='any' OR b.id=$3::uuid) ORDER BY b.id FOR UPDATE OF b`,
        [i.shopId, i.serviceId, i.barberId],
      );
      if (!locked.rows.length) throw new ApiError(422, "That barber isn't available for this service");

      // Re-run the availability computation inside the transaction (FR-07).
      const days = await findSlots(db, {
        shop,
        service,
        barberId: i.barberId,
        fromDate: date,
        toDate: date,
        now,
        ignoreWindow: i.ignoreWindow,
      });
      let candidates = days[0].slots.filter((s) => s.startsAt === t && !busyBarbers.has(s.barberId)).map((s) => s.barberId);
      if (!candidates.length) {
        throw new ApiError(409, "That time was just booked", "SLOT_TAKEN");
      }
      if (candidates.length > 1) {
        const load = await barberLoad(db, candidates, DateTime.fromISO(date, { zone: shop.timezone }).toMillis(), DateTime.fromISO(date, { zone: shop.timezone }).endOf("day").toMillis());
        candidates = candidates.sort((a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0));
      }

      const phone = normalizePhone(i.customer.phone);
      const cust = await db.query(
        `INSERT INTO customers(shop_id,name,phone,email,consent_contact_at) VALUES ($1,$2,$3,$4,now())
         ON CONFLICT (shop_id, phone) DO UPDATE
           SET name=EXCLUDED.name, email=COALESCE(EXCLUDED.email, customers.email), anonymized_at=NULL
         RETURNING id`,
        [i.shopId, i.customer.name.trim(), phone, i.customer.email?.trim() || null],
      );

      const barberRows = await db.query("SELECT id, google_calendar_id FROM barbers WHERE id = ANY($1)", [candidates]);
      for (const barberId of candidates) {
        await db.query("SAVEPOINT try_insert");
        try {
          const wantsCal = !!barberRows.rows.find((b) => b.id === barberId)?.google_calendar_id && env.googleConfigured;
          const r = await db.query(
            `INSERT INTO bookings(shop_id,barber_id,service_id,customer_id,starts_at,ends_at,blocked_until,
                                  duration_min,price,status,source,idempotency_key,calendar_sync_status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'CONFIRMED',$10,$11,$12) RETURNING id`,
            [
              i.shopId, barberId, service.id, cust.rows[0].id,
              new Date(t), new Date(t + service.duration_min * MIN), new Date(t + needMs),
              service.duration_min, service.price, i.source ?? "WEBSITE", i.idempotencyKey ?? null,
              wantsCal ? "PENDING" : "NOT_REQUIRED",
            ],
          );
          const id = r.rows[0].id as string;
          await logEvent(db, id, "CREATED", actor, { source: i.source ?? "WEBSITE" });
          if (i.customer.email) await enqueue(db, "EMAIL", { bookingId: id, kind: "CONFIRMED" }, `EMAIL:CONFIRMED:${id}`);
          if (wantsCal) await enqueue(db, "CAL_UPSERT", { bookingId: id }, `CAL_UPSERT:${id}:${t}`);
          return (await loadBookingView(db, id))!;
        } catch (e: any) {
          await db.query("ROLLBACK TO SAVEPOINT try_insert");
          if (e?.code === "23P01") continue; // overlap: try the next eligible barber
          throw e;
        }
      }
      throw new ApiError(409, "That time was just booked", "SLOT_TAKEN");
    });
  } catch (e: any) {
    if (e?.code === "23505" && i.idempotencyKey) {
      const ex = await pool().query("SELECT id FROM bookings WHERE shop_id=$1 AND idempotency_key=$2", [i.shopId, i.idempotencyKey]);
      if (ex.rows[0]) return (await loadBookingView(pool(), ex.rows[0].id))!;
    }
    // Logged outside the transaction on purpose: it needs its own pooled connection.
    await logFailure(i.shopId, e instanceof ApiError ? e.code ?? `HTTP_${e.status}` : "ERROR", {
      serviceId: i.serviceId, barberId: i.barberId, startsAt: i.startsAt, message: String(e?.message),
    });
    throw e;
  }
}

function assertCustomerMayModify(b: BookingView, now: number) {
  if (+b.startsAt - now < b.cancelCutoffHours * 3600_000)
    throw new ApiError(422, `Changes aren't possible within ${b.cancelCutoffHours} hours of the appointment. Please call the shop.`);
}

export type Actor = { kind: "customer"; token: string } | { kind: "admin"; userId: string; shopId: string };

function authorize(b: BookingView, a: Actor) {
  if (a.kind === "customer") {
    if (a.token !== b.manageToken) throw new ApiError(404, "Booking not found");
  } else if (a.shopId !== b.shopId) throw new ApiError(404, "Booking not found");
}
const actorName = (a: Actor) => (a.kind === "admin" ? `admin:${a.userId}` : "customer");

export async function cancelBooking(id: string, a: Actor, now = Date.now()): Promise<BookingView> {
  return tx(async (db) => {
    const b = await loadBookingView(db, id, true);
    if (!b) throw new ApiError(404, "Booking not found");
    authorize(b, a);
    if (!["CONFIRMED", "PENDING"].includes(b.status)) throw new ApiError(422, "This appointment is already " + b.status.toLowerCase());
    if (a.kind === "customer") assertCustomerMayModify(b, now);
    await db.query("UPDATE bookings SET status='CANCELLED', updated_at=now() WHERE id=$1", [id]);
    await logEvent(db, id, "CANCELLED", actorName(a));
    if (b.customerEmail) await enqueue(db, "EMAIL", { bookingId: id, kind: "CANCELLED" }, `EMAIL:CANCELLED:${id}`);
    const ev = await db.query("SELECT calendar_event_id FROM bookings WHERE id=$1", [id]);
    if (ev.rows[0].calendar_event_id && b.calendarId)
      await enqueue(db, "CAL_DELETE", { shopId: b.shopId, calendarId: b.calendarId, eventId: ev.rows[0].calendar_event_id }, `CAL_DELETE:${id}`);
    return (await loadBookingView(db, id))!;
  });
}

export async function rescheduleBooking(
  id: string,
  a: Actor,
  startsAt: Date,
  opts: { barberId?: string; now?: number } = {},
): Promise<BookingView> {
  const now = opts.now ?? Date.now();
  const t = startsAt.getTime();
  const current = await loadBookingView(pool(), id);
  if (!current) throw new ApiError(404, "Booking not found");
  authorize(current, a);
  const shop = await getShop(pool(), current.shopId);
  if (a.kind === "customer") checkWindow(shop, t, now);
  const service = await getActiveService(pool(), current.shopId, current.serviceId).catch(() => {
    throw new ApiError(422, "This service is no longer offered. Please call the shop.");
  });
  // Keep the booked duration even if the service has since changed.
  const svc = { ...service, duration_min: current.durationMin };
  const barberId = a.kind === "admin" && opts.barberId ? opts.barberId : current.barberId;
  const needMs = (svc.duration_min + svc.buffer_min) * MIN;
  const busy = await externalConflicts(shop, svc.id, barberId, t, t + needMs, id);

  return tx(async (db) => {
    const b = await loadBookingView(db, id, true);
    if (!b || !["CONFIRMED", "PENDING"].includes(b.status)) throw new ApiError(422, "This appointment can't be changed");
    if (a.kind === "customer") assertCustomerMayModify(b, now);
    await db.query("SELECT id FROM barbers WHERE id=$1 FOR UPDATE", [barberId]);
    const date = DateTime.fromMillis(t, { zone: shop.timezone }).toISODate()!;
    const days = await findSlots(db, {
      shop, service: svc, barberId, fromDate: date, toDate: date, now,
      excludeBookingId: id, ignoreWindow: a.kind === "admin",
    });
    if (!days[0].slots.some((s) => s.startsAt === t) || busy.has(barberId))
      throw new ApiError(409, "That time was just booked", "SLOT_TAKEN");
    try {
      await db.query("SAVEPOINT r");
      await db.query(
        `UPDATE bookings SET starts_at=$2, ends_at=$3, blocked_until=$4, barber_id=$5, updated_at=now(),
                calendar_sync_status = CASE WHEN calendar_sync_status='NOT_REQUIRED' THEN 'NOT_REQUIRED'::sync_status ELSE 'PENDING'::sync_status END
          WHERE id=$1`,
        [id, new Date(t), new Date(t + svc.duration_min * MIN), new Date(t + needMs), barberId],
      );
    } catch (e: any) {
      if (e?.code === "23P01") throw new ApiError(409, "That time was just booked", "SLOT_TAKEN");
      throw e;
    }
    await logEvent(db, id, "RESCHEDULED", actorName(a), { from: b.startsAt, to: startsAt });
    if (b.customerEmail) await enqueue(db, "EMAIL", { bookingId: id, kind: "RESCHEDULED" }, `EMAIL:RESCHEDULED:${id}:${t}`);
    if (b.calendarId && env.googleConfigured) await enqueue(db, "CAL_UPSERT", { bookingId: id }, `CAL_UPSERT:${id}:${t}`);
    return (await loadBookingView(db, id))!;
  });
}

/** Admin: mark a booking COMPLETED / NO_SHOW. */
export async function setBookingStatus(id: string, shopId: string, userId: string, status: "COMPLETED" | "NO_SHOW") {
  return tx(async (db) => {
    const b = await loadBookingView(db, id, true);
    if (!b || b.shopId !== shopId) throw new ApiError(404, "Booking not found");
    if (b.status !== "CONFIRMED") throw new ApiError(422, "Only confirmed bookings can be updated");
    await db.query("UPDATE bookings SET status=$2, updated_at=now() WHERE id=$1", [id, status]);
    await logEvent(db, id, status, `admin:${userId}`);
    return (await loadBookingView(db, id))!;
  });
}
