"use client";
import { useEffect, useState } from "react";
import { DateTime } from "luxon";
import { api, useApi } from "@/components/admin";

type Barber = { id: string; displayName: string; active: boolean };
type Iv = { weekday: number; start: string; end: string };
type Off = { id: string; barberId: string; barber: string; startsAt: string; endsAt: string; reason: string };
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function ScheduleEditor() {
  const { data: bd } = useApi<{ barbers: Barber[] }>("/api/admin/barbers");
  const [barberId, setBarberId] = useState("");
  const barbers = bd?.barbers.filter((b) => b.active) ?? [];
  useEffect(() => { if (!barberId && barbers[0]) setBarberId(barbers[0].id); }, [barbers, barberId]);

  return (
    <>
      <div className="mb-4 max-w-xs">
        <label htmlFor="barber" className="label">Barber</label>
        <select id="barber" className="input" value={barberId} onChange={(e) => setBarberId(e.target.value)}>
          {barbers.map((b) => <option key={b.id} value={b.id}>{b.displayName}</option>)}
        </select>
      </div>
      {barberId && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Hours key={barberId} barberId={barberId} />
          <TimeOff key={"t" + barberId} barberId={barberId} />
        </div>
      )}
    </>
  );
}

function Hours({ barberId }: { barberId: string }) {
  const { data, error } = useApi<{ intervals: Iv[] }>(`/api/admin/barbers/${barberId}/schedule`);
  const [iv, setIv] = useState<Iv[]>([]);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => { if (data) setIv(data.intervals); }, [data]);

  const set = (i: number, patch: Partial<Iv>) => setIv((l) => l.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const save = async () => {
    setMsg(""); setErr("");
    try { await api(`/api/admin/barbers/${barberId}/schedule`, "PUT", { intervals: iv }); setMsg("Saved. New bookings follow these hours right away."); }
    catch (e) { setErr((e as Error).message); }
  };

  return (
    <section className="card" aria-labelledby="wh">
      <h2 id="wh" className="mb-1 font-semibold">Weekly hours</h2>
      <p className="mb-3 text-sm text-gray-600">Add more than one block in a day for breaks (e.g. 9:00–12:00 and 13:00–17:00).</p>
      {(error || err) && <p role="alert" className="err mb-3">{error || err}</p>}
      {msg && <p role="status" className="mb-3 rounded-lg bg-green-50 p-3 text-sm text-green-900">{msg}</p>}
      {DAYS.map((name, d) => {
        const rows = iv.map((x, i) => ({ x, i })).filter((r) => r.x.weekday === d + 1);
        return (
          <fieldset key={name} className="mb-3 border-b pb-3 last:border-0">
            <legend className="font-medium">{name}</legend>
            {rows.length === 0 && <p className="text-sm text-gray-500">Day off</p>}
            {rows.map(({ x, i }) => (
              <div key={i} className="mt-1 flex items-center gap-2">
                <input aria-label={`${name} start`} type="time" className="input" value={x.start} onChange={(e) => set(i, { start: e.target.value })} />
                <span>to</span>
                <input aria-label={`${name} end`} type="time" className="input" value={x.end} onChange={(e) => set(i, { end: e.target.value })} />
                <button className="btn-secondary min-h-[44px] px-3" aria-label={`Remove ${name} block`} onClick={() => setIv((l) => l.filter((_, k) => k !== i))}>✕</button>
              </div>
            ))}
            <button className="mt-2 text-sm font-medium underline" onClick={() => setIv((l) => [...l, { weekday: d + 1, start: rows.length ? "13:00" : "09:00", end: rows.length ? "17:00" : "17:00" }])}>+ Add hours</button>
          </fieldset>
        );
      })}
      <button className="btn-primary w-full" onClick={save}>Save hours</button>
    </section>
  );
}

function TimeOff({ barberId }: { barberId: string }) {
  const { data, reload, error } = useApi<{ timeOff: Off[] }>(`/api/admin/time-off?barberId=${barberId}`);
  const today = DateTime.now().toISODate()!;
  const [f, setF] = useState({ date: today, endDate: today, allDay: true, start: "09:00", end: "17:00", reason: "" });
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const add = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg(""); setErr("");
    try {
      const body = {
        barberId, reason: f.reason,
        startLocal: `${f.date}T${f.allDay ? "00:00" : f.start}`,
        endLocal: f.allDay ? `${DateTime.fromISO(f.endDate).plus({ days: 1 }).toISODate()}T00:00` : `${f.endDate}T${f.end}`,
      };
      const r = await api<{ conflictingBookings: { startsAt: string; customer: string }[] }>("/api/admin/time-off", "POST", body);
      setMsg(r.conflictingBookings.length
        ? `Time off added, but ${r.conflictingBookings.length} existing booking(s) fall inside it. Reschedule or cancel them under Today/Bookings: ${r.conflictingBookings.map((c) => c.customer).join(", ")}.`
        : "Time off added.");
      reload();
    } catch (x) { setErr((x as Error).message); }
  };
  const remove = async (id: string) => { await api(`/api/admin/time-off/${id}`, "DELETE"); reload(); };

  return (
    <section className="card" aria-labelledby="to">
      <h2 id="to" className="mb-3 font-semibold">Time off &amp; blocked time</h2>
      <form onSubmit={add} className="space-y-3">
        {(error || err) && <p role="alert" className="err">{error || err}</p>}
        {msg && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm">{msg}</p>}
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label" htmlFor="d1">From date</label><input id="d1" type="date" className="input" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value, endDate: e.target.value > f.endDate ? e.target.value : f.endDate })} /></div>
          <div><label className="label" htmlFor="d2">To date</label><input id="d2" type="date" className="input" min={f.date} value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></div>
        </div>
        <label className="flex min-h-[44px] items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={f.allDay} onChange={(e) => setF({ ...f, allDay: e.target.checked })} /> All day</label>
        {!f.allDay && (
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label" htmlFor="t1">Start time</label><input id="t1" type="time" className="input" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></div>
            <div><label className="label" htmlFor="t2">End time</label><input id="t2" type="time" className="input" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></div>
          </div>
        )}
        <div><label className="label" htmlFor="rs">Reason (optional)</label><input id="rs" className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></div>
        <button className="btn-primary w-full">Block this time</button>
      </form>
      <h3 className="mb-2 mt-6 text-sm font-semibold">Upcoming</h3>
      {data?.timeOff.length === 0 && <p className="text-sm text-gray-500">Nothing scheduled.</p>}
      <ul className="space-y-2">
        {data?.timeOff.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm">
            <span>{DateTime.fromISO(t.startsAt).toFormat("LLL d, h:mm a")} → {DateTime.fromISO(t.endsAt).toFormat("LLL d, h:mm a")}{t.reason && ` · ${t.reason}`}</span>
            <button className="btn-secondary min-h-[40px] px-3 text-sm" onClick={() => remove(t.id)}>Remove</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
