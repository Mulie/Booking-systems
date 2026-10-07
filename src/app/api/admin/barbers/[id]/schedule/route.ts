import { z } from "zod";
import { body, json, route } from "@/lib/api";
import { assertBarberScope, requireAdmin } from "@/lib/auth";
import { query, tx } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { audit } from "@/lib/audit";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/);
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

const schema = z.object({
  // Several intervals per weekday express breaks, e.g. 09:00-12:00 + 13:00-17:00.
  intervals: z.array(z.object({ weekday: z.number().int().min(1).max(7), start: hhmm, end: hhmm })).max(100),
});

export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const s = await requireAdmin();
  const { id } = await ctx.params;
  assertBarberScope(s, id);
  const rows = await query(
    `SELECT r.weekday, r.start_minute AS "start", r.end_minute AS "end" FROM availability_rules r
       JOIN barbers b ON b.id=r.barber_id WHERE b.id=$1 AND b.shop_id=$2 ORDER BY r.weekday, r.start_minute`,
    [id, s.shopId],
  );
  const f = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return json({ intervals: rows.map((r) => ({ weekday: r.weekday, start: f(r.start), end: f(r.end) })) });
});

export const PUT = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const s = await requireAdmin({ mutating: true });
  const { id } = await ctx.params;
  assertBarberScope(s, id);
  const d = await body(req, schema);
  const iv = d.intervals.map((i) => ({ ...i, a: toMin(i.start), b: toMin(i.end) }));
  for (const i of iv) if (i.b <= i.a) throw new ApiError(422, "Each interval must end after it starts");
  const sorted = [...iv].sort((x, y) => x.weekday - y.weekday || x.a - y.a);
  for (let k = 1; k < sorted.length; k++)
    if (sorted[k].weekday === sorted[k - 1].weekday && sorted[k].a < sorted[k - 1].b) throw new ApiError(422, "Intervals on the same day overlap");
  await tx(async (db) => {
    const ok = await db.query("SELECT 1 FROM barbers WHERE id=$1 AND shop_id=$2", [id, s.shopId]);
    if (!ok.rowCount) throw new ApiError(404, "Barber not found");
    await db.query("DELETE FROM availability_rules WHERE barber_id=$1", [id]);
    for (const i of iv)
      await db.query("INSERT INTO availability_rules(barber_id,weekday,start_minute,end_minute) VALUES ($1,$2,$3,$4)", [id, i.weekday, i.a, i.b]);
  });
  await audit(s, "schedule.update", "barber", id, { intervals: iv.length });
  return json({ ok: true });
});
