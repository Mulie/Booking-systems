import { z } from "zod";
import { DateTime } from "luxon";
import { body, json, route } from "@/lib/api";
import { assertBarberScope, requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { audit } from "@/lib/audit";

export const GET = route(async (req: Request) => {
  const s = await requireAdmin();
  const barberId = s.role === "barber" ? s.barberId : new URL(req.url).searchParams.get("barberId");
  const rows = await query(
    `SELECT t.id, t.barber_id AS "barberId", br.display_name AS barber, t.starts_at AS "startsAt", t.ends_at AS "endsAt", t.reason
       FROM time_off t JOIN barbers br ON br.id=t.barber_id
      WHERE br.shop_id=$1 AND t.ends_at > now() AND ($2::uuid IS NULL OR t.barber_id=$2) ORDER BY t.starts_at`,
    [s.shopId, barberId ?? null],
  );
  return json({ timeOff: rows });
});

/** Time off blocks new bookings. Existing bookings inside the window are reported so staff can move them. */
export const POST = route(async (req: Request) => {
  const s = await requireAdmin({ mutating: true });
  const d = await body(
    req,
    z.object({
      barberId: z.string().uuid(),
      // Either absolute instants, or shop-local wall-clock times ("2026-10-14T09:00") so staff never think in UTC.
      startsAt: z.string().datetime({ offset: true }).optional(),
      endsAt: z.string().datetime({ offset: true }).optional(),
      startLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional(),
      endLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional(),
      reason: z.string().trim().max(200).default(""),
    }),
  );
  assertBarberScope(s, d.barberId);
  const tz = (await query("SELECT timezone FROM shops WHERE id=$1", [s.shopId]))[0].timezone;
  const starts = d.startLocal ? DateTime.fromISO(d.startLocal, { zone: tz }).toJSDate() : d.startsAt ? new Date(d.startsAt) : null;
  const ends = d.endLocal ? DateTime.fromISO(d.endLocal, { zone: tz }).toJSDate() : d.endsAt ? new Date(d.endsAt) : null;
  if (!starts || !ends) throw new ApiError(400, "Start and end are required");
  if (ends <= starts) throw new ApiError(422, "End must be after start");
  const ok = await query("SELECT 1 FROM barbers WHERE id=$1 AND shop_id=$2", [d.barberId, s.shopId]);
  if (!ok.length) throw new ApiError(404, "Barber not found");
  const r = await query("INSERT INTO time_off(barber_id,starts_at,ends_at,reason) VALUES ($1,$2,$3,$4) RETURNING id", [
    d.barberId, starts, ends, d.reason,
  ]);
  const conflicts = await query(
    `SELECT b.id, b.starts_at AS "startsAt", c.name AS customer FROM bookings b JOIN customers c ON c.id=b.customer_id
      WHERE b.barber_id=$1 AND b.status IN ('PENDING','CONFIRMED') AND b.starts_at < $3 AND b.blocked_until > $2`,
    [d.barberId, starts, ends],
  );
  await audit(s, "timeoff.create", "time_off", r[0].id, d);
  return json({ id: r[0].id, conflictingBookings: conflicts }, 201);
});
