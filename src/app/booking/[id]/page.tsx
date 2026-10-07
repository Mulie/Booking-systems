import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { loadBookingView, publicBooking } from "@/lib/booking";
import { pool } from "@/lib/db";
import { safeEqual } from "@/lib/crypto";
import { ManageBooking } from "./ManageBooking";

export const metadata = { title: "Your appointment", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function BookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string; new?: string }>;
}) {
  const { id } = await params;
  const { token = "", new: isNew } = await searchParams;
  const b = await loadBookingView(pool(), id);
  if (!b || !safeEqual(token, b.manageToken)) notFound();
  const pb = publicBooking(b);
  const start = DateTime.fromISO(pb.startsAt, { zone: b.timezone });
  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <ManageBooking
        id={id}
        token={token}
        isNew={!!isNew}
        booking={{
          status: pb.status,
          date: start.toFormat("cccc, LLLL d"),
          time: start.toFormat("h:mm a"),
          startsAt: pb.startsAt,
          service: pb.service.name,
          serviceId: pb.service.id,
          durationMin: pb.service.durationMin,
          price: pb.service.price,
          barber: pb.barber.name,
          barberId: pb.barber.id,
          shop: pb.shop,
          canModify: pb.canModify,
          cutoffHours: b.cancelCutoffHours,
        }}
      />
    </main>
  );
}
