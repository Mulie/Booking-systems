import { json, route } from "@/lib/api";
import { requireAdmin, getSession } from "@/lib/auth";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { query } from "@/lib/db";
import { calendarFor, eventIdFor } from "@/lib/google";
import { enqueue } from "@/lib/jobs";
import { runDueJobs } from "@/lib/jobs";
import { pool } from "@/lib/db";
import { ApiError } from "@/lib/errors";

/**
 * Reconciliation (admin session or cron secret). For each future confirmed booking on a synced barber:
 *  - no/failed event      -> enqueue (re)creation
 *  - event deleted in GCal -> recreate (the DB booking is authoritative)
 *  - event moved in GCal   -> never overwrite silently: record CALENDAR_DRIFT for staff review
 */
export const POST = route(async (req: Request) => {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  let shopId: string | null = null;
  if (env.cronSecret && safeEqual(bearer, env.cronSecret)) {
    shopId = (await query("SELECT id FROM shops ORDER BY created_at LIMIT 1"))[0]?.id ?? null;
  } else {
    shopId = (await requireAdmin({ manage: true, mutating: true })).shopId;
  }
  if (!shopId) throw new ApiError(404, "Shop not found");
  const cal = await calendarFor(shopId);
  if (!cal) return json({ skipped: "Google Calendar is not connected" });

  const rows = await query(
    `SELECT b.id, b.starts_at, b.ends_at, b.calendar_event_id, b.calendar_sync_status, br.google_calendar_id AS cal
       FROM bookings b JOIN barbers br ON br.id=b.barber_id
      WHERE b.shop_id=$1 AND b.status IN ('PENDING','CONFIRMED') AND b.ends_at > now() AND br.google_calendar_id IS NOT NULL`,
    [shopId],
  );
  let requeued = 0, drift = 0, ok = 0;
  for (const b of rows) {
    if (!b.calendar_event_id || b.calendar_sync_status !== "SYNCED") {
      await pool().query("UPDATE bookings SET calendar_sync_status='PENDING' WHERE id=$1", [b.id]);
      await enqueue(pool(), "CAL_UPSERT", { bookingId: b.id }, `CAL_UPSERT:${b.id}:reconcile:${Date.now()}`);
      requeued++;
      continue;
    }
    try {
      const ev = await cal.events.get({ calendarId: b.cal, eventId: eventIdFor(b.id) });
      if (ev.data.status === "cancelled") throw Object.assign(new Error("gone"), { code: 404 });
      const s = Date.parse(ev.data.start?.dateTime ?? ""), e = Date.parse(ev.data.end?.dateTime ?? "");
      if (s !== +b.starts_at || e !== +b.ends_at) {
        drift++;
        await query("INSERT INTO booking_events(booking_id,event_type,actor,metadata) VALUES ($1,'CALENDAR_DRIFT','system',$2)", [
          b.id, JSON.stringify({ calendarStart: ev.data.start?.dateTime, calendarEnd: ev.data.end?.dateTime }),
        ]);
      } else ok++;
    } catch (err: any) {
      if (err?.code === 404 || err?.code === 410) {
        await enqueue(pool(), "CAL_UPSERT", { bookingId: b.id }, `CAL_UPSERT:${b.id}:reconcile:${Date.now()}`);
        requeued++;
      } else console.error("reconcile error", err?.message);
    }
  }
  const run = await runDueJobs(50);
  return json({ checked: rows.length, inSync: ok, requeued, drift, jobs: run });
});
