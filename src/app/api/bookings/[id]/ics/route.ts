import { loadBookingView } from "@/lib/booking";
import { pool } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { route } from "@/lib/api";
import { safeEqual } from "@/lib/crypto";

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s: string) => s.replace(/[\;,]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");

export const GET = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const b = await loadBookingView(pool(), id);
  if (!b || !safeEqual(token, b.manageToken)) throw new ApiError(404, "Booking not found");
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Barber Booking//EN", "BEGIN:VEVENT",
    `UID:${b.id}@booking`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(b.startsAt)}`, `DTEND:${stamp(b.endsAt)}`,
    `SUMMARY:${esc(`${b.serviceName} with ${b.barberName}`)}`, `LOCATION:${esc(`${b.shopName}, ${b.shopAddress}`)}`,
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  return new Response(ics, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'attachment; filename="appointment.ics"' } });
});
