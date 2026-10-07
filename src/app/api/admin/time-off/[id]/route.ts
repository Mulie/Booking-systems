import { json, route } from "@/lib/api";
import { assertBarberScope, requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { audit } from "@/lib/audit";

export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const s = await requireAdmin({ mutating: true });
  const { id } = await ctx.params;
  const row = (await query(
    "SELECT t.barber_id FROM time_off t JOIN barbers b ON b.id=t.barber_id WHERE t.id=$1 AND b.shop_id=$2",
    [id, s.shopId],
  ))[0];
  if (!row) throw new ApiError(404, "Not found");
  assertBarberScope(s, row.barber_id);
  await query("DELETE FROM time_off WHERE id=$1", [id]);
  await audit(s, "timeoff.delete", "time_off", id);
  return json({ ok: true });
});
