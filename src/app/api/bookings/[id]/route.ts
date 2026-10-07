import { loadBookingView, publicBooking } from "@/lib/booking";
import { pool } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { json, limit, route } from "@/lib/api";
import { safeEqual } from "@/lib/crypto";

export const GET = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await limit("booking-read", 30);
  const { id } = await ctx.params;
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const b = await loadBookingView(pool(), id);
  // Same 404 for "missing" and "wrong token" so IDs can't be probed.
  if (!b || !safeEqual(token, b.manageToken)) throw new ApiError(404, "Booking not found");
  return json({ booking: publicBooking(b) });
});
