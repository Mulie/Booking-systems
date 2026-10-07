"use client";
import { useMemo, useState } from "react";
import { DateTime } from "luxon";
import { api, StatusBadge, SyncBadge, useApi } from "@/components/admin";
import { SlotPicker, to12h, type Slot } from "@/components/SlotPicker";

type Row = {
  id: string; startsAt: string; endsAt: string; status: string; source: string; price: string; calendarSync: string;
  service: string; serviceId: string; barberId: string; barber: string; customer: string; phone: string; email: string | null;
};
type Svc = { id: string; name: string };
type Barber = { id: string; displayName: string; active: boolean };

export function BookingsPanel({ mode }: { mode: "today" | "all" }) {
  const today = DateTime.now().toISODate()!;
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(mode === "today" ? today : DateTime.now().plus({ days: 7 }).toISODate()!);
  const [barberId, setBarberId] = useState("");
  const [status, setStatus] = useState("");
  const qs = new URLSearchParams({ from, to, ...(barberId && { barberId }), ...(status && { status }) });
  const { data, error, reload } = useApi<{ timezone: string; bookings: Row[] }>(`/api/admin/bookings?${qs}`);
  const { data: bd } = useApi<{ barbers: Barber[] }>("/api/admin/barbers");
  const [msg, setMsg] = useState("");
  const [resched, setResched] = useState<Row | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [adding, setAdding] = useState(false);

  const act = async (id: string, body: object, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    setMsg("");
    try { await api(`/api/admin/bookings/${id}`, "PATCH", body); setResched(null); setSlot(null); await reload(); }
    catch (e) { setMsg((e as Error).message); }
  };

  const tz = data?.timezone ?? "America/Toronto";
  const fmt = (iso: string) => DateTime.fromISO(iso, { zone: tz });
  const grouped = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const b of data?.bookings ?? []) m.set(b.barber, [...(m.get(b.barber) ?? []), b]);
    return [...m.entries()];
  }, [data]);

  return (
    <>
      {mode === "all" && (
        <form className="card mb-4 grid grid-cols-2 gap-3 md:grid-cols-5" onSubmit={(e) => e.preventDefault()}>
          <div><label className="label" htmlFor="f">From</label><input id="f" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label className="label" htmlFor="t">To</label><input id="t" type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div><label className="label" htmlFor="b">Barber</label>
            <select id="b" className="input" value={barberId} onChange={(e) => setBarberId(e.target.value)}><option value="">All</option>
              {bd?.barbers.map((b) => <option key={b.id} value={b.id}>{b.displayName}</option>)}</select></div>
          <div><label className="label" htmlFor="s">Status</label>
            <select id="s" className="input" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>
              {["CONFIRMED", "PENDING", "CANCELLED", "COMPLETED", "NO_SHOW"].map((s) => <option key={s}>{s}</option>)}</select></div>
          <div className="flex items-end"><button type="button" className="btn-primary w-full" onClick={() => setAdding((a) => !a)}>{adding ? "Close" : "New booking"}</button></div>
        </form>
      )}
      {mode === "today" && <button className="btn-secondary mb-4" onClick={() => setAdding((a) => !a)}>{adding ? "Close" : "New booking"}</button>}
      {adding && <NewBooking onDone={() => { setAdding(false); reload(); }} />}
      {(error || msg) && <p role="alert" className="err mb-4">{error || msg}</p>}

      {data && data.bookings.length === 0 && <p className="card text-center text-gray-600">No bookings for this selection.</p>}

      {mode === "today" ? (
        <div className="grid gap-4 md:grid-cols-2">
          {grouped.map(([barber, rows]) => (
            <section key={barber} aria-label={barber}>
              <h2 className="mb-2 font-semibold">{barber}</h2>
              <ol className="space-y-2">{rows.map((b) => <Item key={b.id} b={b} fmt={fmt} act={act} onResched={() => { setResched(b); setSlot(null); }} />)}</ol>
            </section>
          ))}
        </div>
      ) : (
        <ol className="space-y-2">
          {data?.bookings.map((b) => (
            <Item key={b.id} b={b} fmt={fmt} act={act} showDate onResched={() => { setResched(b); setSlot(null); }} />
          ))}
        </ol>
      )}

      {resched && (
        <div role="dialog" aria-modal="true" aria-label="Reschedule" className="fixed inset-0 z-40 overflow-y-auto bg-black/40 p-4">
          <div className="mx-auto mt-8 max-w-md rounded-xl bg-white p-4">
            <h2 className="mb-1 text-lg font-bold">Reschedule {resched.customer}</h2>
            <p className="mb-3 text-sm text-gray-600">{resched.service} with {resched.barber}. The customer will be emailed.</p>
            <SlotPicker serviceId={resched.serviceId} barberId={resched.barberId} excludeBookingId={resched.id} selected={slot?.startsAt ?? null} onSelect={setSlot} />
            <div className="mt-4 flex gap-2">
              <button className="btn-primary flex-1" disabled={!slot} onClick={() => act(resched.id, { action: "reschedule", startsAt: slot!.startsAt })}>Move here</button>
              <button className="btn-secondary" onClick={() => setResched(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Item({ b, fmt, act, onResched, showDate }: {
  b: Row; fmt: (s: string) => DateTime; act: (id: string, body: object, c?: string) => void; onResched: () => void; showDate?: boolean;
}) {
  const live = b.status === "CONFIRMED" || b.status === "PENDING";
  const past = fmt(b.endsAt) < DateTime.now();
  return (
    <li className="card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">{showDate && fmt(b.startsAt).toFormat("ccc LLL d · ")}{fmt(b.startsAt).toFormat("h:mm a")} – {fmt(b.endsAt).toFormat("h:mm a")}</p>
        <div className="flex gap-1"><StatusBadge status={b.status} /><SyncBadge s={b.calendarSync} /></div>
      </div>
      <p>{b.customer} · <a className="underline" href={`tel:${b.phone}`}>{b.phone}</a></p>
      <p className="text-sm text-gray-600">{b.service} · {b.barber} · ${Number(b.price).toFixed(0)}{b.source === "ADMIN" ? " · added by staff" : ""}</p>
      {live && (
        <div className="mt-3 flex flex-wrap gap-2">
          {past && <button className="btn-secondary min-h-[40px] px-3 text-sm" onClick={() => act(b.id, { action: "complete" })}>Complete</button>}
          {past && <button className="btn-secondary min-h-[40px] px-3 text-sm" onClick={() => act(b.id, { action: "no_show" })}>No-show</button>}
          {!past && <button className="btn-secondary min-h-[40px] px-3 text-sm" onClick={onResched}>Reschedule</button>}
          <button className="btn-danger min-h-[40px] px-3 text-sm" onClick={() => act(b.id, { action: "cancel" }, `Cancel ${b.customer}'s appointment? They will be notified.`)}>Cancel</button>
        </div>
      )}
    </li>
  );
}

function NewBooking({ onDone }: { onDone: () => void }) {
  const { data: sd } = useApi<{ services: (Svc & { active: boolean })[] }>("/api/admin/services");
  const { data: bd } = useApi<{ barbers: (Barber & { serviceIds: string[] })[] }>("/api/admin/barbers");
  const [serviceId, setServiceId] = useState("");
  const [barberId, setBarberId] = useState("");
  const [slot, setSlot] = useState<Slot | null>(null);
  const [c, setC] = useState({ name: "", phone: "", email: "" });
  const [err, setErr] = useState("");
  const barbers = bd?.barbers.filter((b) => b.active && b.serviceIds.includes(serviceId)) ?? [];

  return (
    <form className="card mb-4 space-y-3" onSubmit={async (e) => {
      e.preventDefault(); setErr("");
      try { await api("/api/admin/bookings", "POST", { serviceId, barberId, startsAt: slot!.startsAt, customer: c }); onDone(); }
      catch (x) { setErr((x as Error).message); }
    }}>
      <h2 className="font-semibold">New booking (phone / walk-in)</h2>
      {err && <p role="alert" className="err">{err}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        <div><label className="label" htmlFor="ns">Service</label><select id="ns" className="input" value={serviceId} required onChange={(e) => { setServiceId(e.target.value); setBarberId(""); setSlot(null); }}>
          <option value="">Select…</option>{sd?.services.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div><label className="label" htmlFor="nb">Barber</label><select id="nb" className="input" value={barberId} required onChange={(e) => { setBarberId(e.target.value); setSlot(null); }}>
          <option value="">Select…</option>{barbers.map((b) => <option key={b.id} value={b.id}>{b.displayName}</option>)}</select></div>
      </div>
      {serviceId && barberId && <SlotPicker serviceId={serviceId} barberId={barberId} selected={slot?.startsAt ?? null} onSelect={setSlot} />}
      {slot && <p className="text-sm">Selected: <strong>{slot.date} {to12h(slot.start)}</strong></p>}
      <div className="grid gap-3 md:grid-cols-3">
        <div><label className="label" htmlFor="cn">Customer name</label><input id="cn" className="input" required value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></div>
        <div><label className="label" htmlFor="cp">Phone</label><input id="cp" className="input" type="tel" required value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} /></div>
        <div><label className="label" htmlFor="ce">Email (optional)</label><input id="ce" className="input" type="email" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} /></div>
      </div>
      <button className="btn-primary" disabled={!slot}>Create booking</button>
    </form>
  );
}
