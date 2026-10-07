import { z } from "zod";
import { after } from "next/server";
import { body, json, route } from "@/lib/api";
import { assertBarberScope, requireAdmin } from "@/lib/auth";
import { cancelBooking, loadBookingView, publicBooking, rescheduleBooking, setBookingStatus } from "@/lib/booking";
import { pool } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { runDueJobs } from "@/lib/jobs";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("complete") }),
  z.object({ action: z.literal("no_show") }),
  z.object({ action: z.literal("reschedule"), startsAt: z.string().datetime({ offset: true }), barberId: z.string().uuid().optional() }),
]);

/** FR-11: admin cancel / reschedule (customer is notified by the queued email job). */
export const PATCH = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const s = await requireAdmin({ mutating: true });
  const { id } = await ctx.params;
  const cur = await loadBookingView(pool(), id);
  if (!cur || cur.shopId !== s.shopId) throw new ApiError(404, "Booking not found");
  assertBarberScope(s, cur.barberId);
  const d = await body(req, schema);
  const actor = { kind: "admin" as const, userId: s.uid, shopId: s.shopId };
  const b =
    d.action === "cancel" ? await cancelBooking(id, actor)
    : d.action === "reschedule" ? await rescheduleBooking(id, actor, new Date(d.startsAt), { barberId: d.barberId })
    : await setBookingStatus(id, s.shopId, s.uid, d.action === "complete" ? "COMPLETED" : "NO_SHOW");
  await audit(s, `booking.${d.action}`, "booking", id);
  after(() => runDueJobs().catch(() => {}));
  return json({ booking: publicBooking(b) });
});
