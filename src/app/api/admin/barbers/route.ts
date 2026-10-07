import { z } from "zod";
import { body, json, route } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { audit } from "@/lib/audit";
import { barberSchema } from "@/lib/schemas";


export const GET = route(async () => {
  const s = await requireAdmin();
  const rows = await query(
    `SELECT b.id, b.display_name AS "displayName", b.bio, b.photo_url AS "photoUrl", b.active, b.buffer_min AS "bufferMin",
            b.google_calendar_id AS "googleCalendarId", b.google_busy_sync AS "googleBusySync",
            COALESCE((SELECT array_agg(service_id) FROM barber_services WHERE barber_id=b.id AND active), '{}') AS "serviceIds"
       FROM barbers b WHERE b.shop_id=$1 AND ($2::uuid IS NULL OR b.id=$2) ORDER BY b.active DESC, b.display_name`,
    [s.shopId, s.role === "barber" ? s.barberId : null],
  );
  return json({ barbers: rows });
});

export const POST = route(async (req: Request) => {
  const s = await requireAdmin({ manage: true, mutating: true });
  const d = await body(req, barberSchema);
  const r = await query(
    `INSERT INTO barbers(shop_id,display_name,bio,photo_url,active,buffer_min,google_calendar_id,google_busy_sync)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [s.shopId, d.displayName, d.bio, d.photoUrl ?? null, d.active, d.bufferMin, d.googleCalendarId || null, d.googleBusySync],
  );
  const ids = d.serviceIds ?? (await query("SELECT id FROM services WHERE shop_id=$1 AND active", [s.shopId])).map((x) => x.id);
  for (const sid of ids) await query("INSERT INTO barber_services(barber_id,service_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [r[0].id, sid]);
  await audit(s, "barber.create", "barber", r[0].id, d);
  return json({ id: r[0].id }, 201);
});
