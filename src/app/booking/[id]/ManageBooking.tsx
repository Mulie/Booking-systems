"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { SlotPicker, dateLabel, to12h, type Slot } from "@/components/SlotPicker";

type B = {
  status: string; date: string; time: string; startsAt: string; service: string; serviceId: string; durationMin: number; price: string;
  barber: string; barberId: string; shop: { name: string; address: string; phone: string; cancellationPolicy: string };
  canModify: boolean; cutoffHours: number;
};

export function ManageBooking({ id, token, isNew, booking: b }: { id: string; token: string; isNew: boolean; booking: B }) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "reschedule" | "confirmCancel">("view");
  const [slot, setSlot] = useState<Slot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const cancelled = b.status === "CANCELLED";
  const active = b.status === "CONFIRMED" || b.status === "PENDING";

  const call = async (path: string, payload: object) => {
    setBusy(true); setError("");
    try {
      const r = await fetch(`/api/bookings/${id}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, ...payload }) });
      const j = await r.json();
      if (r.ok) { setMode("view"); setSlot(null); router.refresh(); return; }
      if (r.status === 409) { setSlot(null); setRefresh((n) => n + 1); setError("That time was just booked. Here are the latest available times."); }
      else setError(j.error?.message ?? "Something went wrong.");
    } catch { setError("Couldn't reach the server. Please try again."); }
    finally { setBusy(false); }
  };

  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${b.shop.name} ${b.shop.address}`)}`;

  return (
    <>
      <div className="text-center" aria-live="polite">
        {cancelled ? <h1 className="text-3xl font-bold">Appointment cancelled</h1>
          : active ? <h1 className="text-3xl font-bold">{isNew ? "You’re booked." : "Your appointment"}</h1>
          : <h1 className="text-3xl font-bold">Appointment {b.status.toLowerCase().replace("_", " ")}</h1>}
        {isNew && active && <p className="mt-1 text-gray-600">We’ve saved your spot. Keep this page or your confirmation email to make changes.</p>}
      </div>

      <dl className="card mt-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <dt className="text-gray-600">Date</dt><dd className="font-semibold">{b.date}</dd>
        <dt className="text-gray-600">Time</dt><dd className="font-semibold">{b.time}</dd>
        <dt className="text-gray-600">Service</dt><dd className="font-semibold">{b.service} ({b.durationMin} min)</dd>
        <dt className="text-gray-600">Barber</dt><dd className="font-semibold">{b.barber}</dd>
        <dt className="text-gray-600">Price</dt><dd className="font-semibold">${Number(b.price).toFixed(2)}</dd>
        <dt className="text-gray-600">Where</dt><dd>{b.shop.name}<br />{b.shop.address}</dd>
      </dl>

      {error && <p role="alert" className="err mt-4">{error}</p>}

      {active && mode === "view" && (
        <div className="mt-6 space-y-3">
          <a className="btn-secondary w-full" href={`/api/bookings/${id}/ics?token=${token}`}>Add to calendar</a>
          <a className="btn-secondary w-full" href={maps} target="_blank" rel="noreferrer">Get directions</a>
          {b.canModify ? (
            <>
              <button className="btn-secondary w-full" onClick={() => setMode("reschedule")}>Choose a new time</button>
              <button className="btn-danger w-full" onClick={() => setMode("confirmCancel")}>Cancel appointment</button>
            </>
          ) : (
            <p className="card text-sm">Changes online close {b.cutoffHours} hours before your appointment. Please call {b.shop.phone ? <a className="underline" href={`tel:${b.shop.phone}`}>{b.shop.phone}</a> : "the shop"}.</p>
          )}
          <p className="text-sm text-gray-600">{b.shop.cancellationPolicy}</p>
        </div>
      )}

      {mode === "confirmCancel" && (
        <div className="card mt-6 space-y-3">
          <p className="font-semibold">Cancel this appointment?</p>
          <p className="text-sm text-gray-600">{b.shop.cancellationPolicy}</p>
          <button className="btn-danger w-full" disabled={busy} onClick={() => call("cancel", {})}>{busy ? "Cancelling…" : "Yes, cancel appointment"}</button>
          <button className="btn-secondary w-full" onClick={() => setMode("view")}>Keep appointment</button>
        </div>
      )}

      {mode === "reschedule" && (
        <section className="mt-6" aria-labelledby="rs">
          <h2 id="rs" className="mb-3 text-xl font-bold">Choose a new time</h2>
          <SlotPicker serviceId={b.serviceId} barberId={b.barberId} excludeBookingId={id} selected={slot?.startsAt ?? null} refreshKey={refresh} onSelect={setSlot} />
          {slot && <p className="mt-4 text-sm">New time: <strong>{slot.date ? dateLabel(slot.date).long : ""}, {to12h(slot.start)}</strong></p>}
          <div className="mt-4 space-y-2">
            <button className="btn-primary w-full" disabled={!slot || busy} onClick={() => call("reschedule", { startsAt: slot!.startsAt })}>{busy ? "Saving…" : "Confirm new time"}</button>
            <button className="btn-secondary w-full" onClick={() => { setMode("view"); setError(""); }}>Back</button>
          </div>
        </section>
      )}

      {cancelled && <a href="/book" className="btn-primary mt-6 w-full">Book again</a>}
    </>
  );
}
