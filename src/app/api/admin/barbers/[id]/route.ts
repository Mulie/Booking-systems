import { body, json, route } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { query, tx } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { barberSchema } from "@/lib/schemas";

/** Deactivating a barber blocks new bookings only; existing ones stay visible. */
export const PATCH = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const s = await requireAdmin({ manage: true, mutating: true });
  const { id } = await ctx.params;
  const d = await body(req, barberSchema.partial());
  await tx(async (db) => {
    const r = await db.query(
      `UPDATE barbers SET display_name=COALESCE($3,display_name), bio=COALESCE($4,bio), active=COALESCE($5,active),
              buffer_min=COALESCE($6,buffer_min), google_busy_sync=COALESCE($7,google_busy_sync),
              photo_url = CASE WHEN $8 THEN $9 ELSE photo_url END,
              google_calendar_id = CASE WHEN $10 THEN $11 ELSE google_calendar_id END
        WHERE id=$1 AND shop_id=$2 RETURNING id`,
      [id, s.shopId, d.displayName ?? null, d.bio ?? null, d.active ?? null, d.bufferMin ?? null, d.googleBusySync ?? null,
       d.photoUrl !== undefined, d.photoUrl ?? null, d.googleCalendarId !== undefined, d.googleCalendarId || null],
    ).catch((e) => {
      if (e.code === "23505") throw new ApiError(422, "An active barber with that name already exists");
      throw e;
    });
    if (!r.rows.length) throw new ApiError(404, "Barber not found");
    if (d.serviceIds) {
      await db.query("UPDATE barber_services SET active=false WHERE barber_id=$1", [id]);
      for (const sid of d.serviceIds)
        await db.query(
          `INSERT INTO barber_services(barber_id,service_id,active) SELECT $1, id, true FROM services WHERE id=$2 AND shop_id=$3
           ON CONFLICT (barber_id, service_id) DO UPDATE SET active=true`,
          [id, sid, s.shopId],
        );
    }
  });
  await audit(s, "barber.update", "barber", id, d);
  return json({ ok: true });
});
