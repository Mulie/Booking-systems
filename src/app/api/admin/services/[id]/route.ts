import { body, json, route } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { serviceSchema } from "@/lib/schemas";

/** Edits apply to future bookings only: bookings snapshot duration and price. Services are deactivated, never deleted. */
export const PATCH = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const s = await requireAdmin({ manage: true, mutating: true });
  const { id } = await ctx.params;
  const d = await body(req, serviceSchema.partial());
  const r = await query(
    `UPDATE services SET name=COALESCE($3,name), description=COALESCE($4,description), duration_min=COALESCE($5,duration_min),
            buffer_min=COALESCE($6,buffer_min), price=COALESCE($7,price), active=COALESCE($8,active), sort_order=COALESCE($9,sort_order)
      WHERE id=$1 AND shop_id=$2 RETURNING id`,
    [id, s.shopId, d.name ?? null, d.description ?? null, d.durationMin ?? null, d.bufferMin ?? null, d.price ?? null, d.active ?? null, d.sortOrder ?? null],
  ).catch((e) => {
    if (e.code === "23505") throw new ApiError(422, "An active service with that name already exists");
    throw e;
  });
  if (!r.length) throw new ApiError(404, "Service not found");
  await audit(s, "service.update", "service", id, d);
  return json({ ok: true });
});
