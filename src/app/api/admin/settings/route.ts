import { z } from "zod";
import { body, json, route } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { audit } from "@/lib/audit";

const schema = z.object({
  name: z.string().trim().min(1).max(100),
  address: z.string().trim().max(200),
  phone: z.string().trim().max(40),
  cancellationPolicy: z.string().trim().min(1).max(600),
  slotIncrementMin: z.number().int().min(5).max(120),
  minLeadMin: z.number().int().min(0).max(60 * 24 * 14),
  horizonDays: z.number().int().min(1).max(365),
  cancelCutoffHours: z.number().int().min(0).max(24 * 14),
}).partial();

export const GET = route(async () => {
  const s = await requireAdmin();
  const r = await query(
    `SELECT name, address, phone, timezone, cancellation_policy AS "cancellationPolicy", slot_increment_min AS "slotIncrementMin",
            min_lead_min AS "minLeadMin", horizon_days AS "horizonDays", cancel_cutoff_hours AS "cancelCutoffHours" FROM shops WHERE id=$1`,
    [s.shopId],
  );
  return json({ settings: r[0] });
});

/** FR-14: booking rules apply to the customer UI immediately (availability is computed live). */
export const PATCH = route(async (req: Request) => {
  const s = await requireAdmin({ manage: true, mutating: true });
  const d = await body(req, schema);
  await query(
    `UPDATE shops SET name=COALESCE($2,name), address=COALESCE($3,address), phone=COALESCE($4,phone),
            cancellation_policy=COALESCE($5,cancellation_policy), slot_increment_min=COALESCE($6,slot_increment_min),
            min_lead_min=COALESCE($7,min_lead_min), horizon_days=COALESCE($8,horizon_days), cancel_cutoff_hours=COALESCE($9,cancel_cutoff_hours)
      WHERE id=$1`,
    [s.shopId, d.name ?? null, d.address ?? null, d.phone ?? null, d.cancellationPolicy ?? null, d.slotIncrementMin ?? null,
     d.minLeadMin ?? null, d.horizonDays ?? null, d.cancelCutoffHours ?? null],
  );
  await audit(s, "settings.update", "shop", s.shopId, d);
  return json({ ok: true });
});
