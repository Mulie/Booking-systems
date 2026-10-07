import { z } from "zod";
import { DateTime } from "luxon";
import { json, route, body } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { getShop } from "@/lib/slots";
import { pool } from "@/lib/db";
import { createBooking, publicBooking } from "@/lib/booking";
import { after } from "next/server";
import { runDueJobs } from "@/lib/jobs";
import { audit } from "@/lib/audit";

const filters = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  barberId: z.string().uuid().optional(),
  status: z.enum(["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW"]).optional(),
});

/** FR-10: list/filter by date, barber and status. Barbers only see their own bookings. */
export const GET = route(async (req: Request) => {
  const s = await requireAdmin();
  const f = filters.parse(Object.fromEntries(new URL(req.url).searchParams));
  const shop = await getShop(pool(), s.shopId);
  const today = DateTime.now().setZone(shop.timezone).toISODate()!;
  const from = DateTime.fromISO(f.from ?? today, { zone: shop.timezone }).startOf("day").toJSDate();
  const to = DateTime.fromISO(f.to ?? f.from ?? today, { zone: shop.timezone }).endOf("day").toJSDate();
  const barberId = s.role === "barber" ? s.barberId : f.barberId ?? null;
  const rows = await query(
    `SELECT b.id, b.starts_at AS "startsAt", b.ends_at AS "endsAt", b.status, b.source, b.price,
            b.calendar_sync_status AS "calendarSync", s.name AS service, s.id AS "serviceId", br.id AS "barberId", br.display_name AS barber,
            c.name AS customer, c.phone, c.email
       FROM bookings b JOIN services s ON s.id=b.service_id JOIN barbers br ON br.id=b.barber_id
       JOIN customers c ON c.id=b.customer_id
      WHERE b.shop_id=$1 AND b.starts_at >= $2 AND b.starts_at <= $3
        AND ($4::uuid IS NULL OR b.barber_id=$4) AND ($5::booking_status IS NULL OR b.status=$5)
      ORDER BY b.starts_at LIMIT 500`,
    [s.shopId, from, to, barberId, f.status ?? null],
  );
  return json({ timezone: shop.timezone, bookings: rows });
});

/** Admin creates a booking on behalf of a customer (phone/walk-in). Ignores lead time and horizon. */
export const POST = route(async (req: Request) => {
  const s = await requireAdmin({ mutating: true });
  const d = await body(
    req,
    z.object({
      serviceId: z.string().uuid(),
      barberId: z.string().uuid(),
      startsAt: z.string().datetime({ offset: true }),
      customer: z.object({
        name: z.string().trim().min(1).max(100),
        phone: z.string().trim().regex(/^\+?[\d\s().-]{7,20}$/),
        email: z.string().email().optional().or(z.literal("").transform(() => undefined)),
      }),
    }),
  );
  if (s.role === "barber" && s.barberId !== d.barberId) return json({ error: { code: "403", message: "Not authorized" } }, 403);
  const b = await createBooking({
    shopId: s.shopId, serviceId: d.serviceId, barberId: d.barberId, startsAt: new Date(d.startsAt),
    customer: d.customer, source: "ADMIN", actor: `admin:${s.uid}`, ignoreWindow: true,
  });
  await audit(s, "booking.create", "booking", b.id);
  after(() => runDueJobs().catch(() => {}));
  return json({ booking: publicBooking(b) }, 201);
});
