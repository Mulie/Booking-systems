import { z } from "zod";
import { after } from "next/server";
import { body, json, limit, route } from "@/lib/api";
import { cancelBooking, publicBooking } from "@/lib/booking";
import { runDueJobs } from "@/lib/jobs";

export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await limit("booking-change", 10);
  const { id } = await ctx.params;
  const { token } = await body(req, z.object({ token: z.string().min(1) }));
  const b = await cancelBooking(id, { kind: "customer", token });
  after(() => runDueJobs().catch(() => {}));
  return json({ booking: publicBooking(b) });
});
