import { z } from "zod";
import { after } from "next/server";
import { body, json, limit, route } from "@/lib/api";
import { publicBooking, rescheduleBooking } from "@/lib/booking";
import { runDueJobs } from "@/lib/jobs";

export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await limit("booking-change", 10);
  const { id } = await ctx.params;
  const d = await body(req, z.object({ token: z.string().min(1), startsAt: z.string().datetime({ offset: true }) }));
  const b = await rescheduleBooking(id, { kind: "customer", token: d.token }, new Date(d.startsAt));
  after(() => runDueJobs().catch(() => {}));
  return json({ booking: publicBooking(b) });
});
