"use client";
import { useEffect, useState } from "react";
import { api, useApi } from "@/components/admin";

type St = { name: string; address: string; phone: string; timezone: string; cancellationPolicy: string; slotIncrementMin: number; minLeadMin: number; horizonDays: number; cancelCutoffHours: number };

export function SettingsEditor({ google }: { google: { configured: boolean; connected: boolean; justConnected: boolean; failed: number } }) {
  const { data, error } = useApi<{ settings: St }>("/api/admin/settings");
  const [s, setS] = useState<St | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [sync, setSync] = useState("");
  useEffect(() => { if (data) setS(data.settings); }, [data]);
  if (!s) return <p>{error || "Loading…"}</p>;
  const num = (k: keyof St) => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: +e.target.value });
  const txt = (k: keyof St) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setS({ ...s, [k]: e.target.value });

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg(""); setErr("");
    const { timezone, ...body } = s;
    try { await api("/api/admin/settings", "PATCH", body); setMsg("Saved. The booking page uses these rules immediately."); } catch (x) { setErr((x as Error).message); }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form onSubmit={save} className="card space-y-3">
        <h2 className="font-semibold">Shop &amp; booking rules</h2>
        {err && <p role="alert" className="err">{err}</p>}{msg && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-900">{msg}</p>}
        <div><label className="label" htmlFor="n">Shop name</label><input id="n" className="input" value={s.name} onChange={txt("name")} /></div>
        <div><label className="label" htmlFor="a">Address</label><input id="a" className="input" value={s.address} onChange={txt("address")} /></div>
        <div><label className="label" htmlFor="p">Phone</label><input id="p" className="input" value={s.phone} onChange={txt("phone")} /></div>
        <p className="text-sm text-gray-600">Time zone: <strong>{s.timezone}</strong></p>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label" htmlFor="i">Booking increment (min)</label><input id="i" className="input" type="number" min={5} step={5} value={s.slotIncrementMin} onChange={num("slotIncrementMin")} /></div>
          <div><label className="label" htmlFor="l">Minimum notice (min)</label><input id="l" className="input" type="number" min={0} step={15} value={s.minLeadMin} onChange={num("minLeadMin")} /></div>
          <div><label className="label" htmlFor="h">Book up to (days ahead)</label><input id="h" className="input" type="number" min={1} value={s.horizonDays} onChange={num("horizonDays")} /></div>
          <div><label className="label" htmlFor="c">Customer can change until (hours before)</label><input id="c" className="input" type="number" min={0} value={s.cancelCutoffHours} onChange={num("cancelCutoffHours")} /></div>
        </div>
        <div><label className="label" htmlFor="cp">Cancellation policy (shown before confirming)</label><textarea id="cp" className="input" rows={3} value={s.cancellationPolicy} onChange={txt("cancellationPolicy")} /></div>
        <button className="btn-primary w-full">Save settings</button>
      </form>

      <section className="card space-y-3 self-start">
        <h2 className="font-semibold">Google Calendar</h2>
        {google.justConnected && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-900">Connected.</p>}
        {!google.configured ? <p className="text-sm text-gray-600">Google isn’t set up on the server yet (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET). Bookings work without it.</p> : (
          <>
            <p className="text-sm">{google.connected ? "✓ Connected. Set each barber’s Calendar ID under Barbers." : "Not connected."}</p>
            <a className="btn-secondary w-full" href="/api/google/connect">{google.connected ? "Reconnect Google" : "Connect Google Calendar"}</a>
            {google.connected && (
              <>
                {google.failed > 0 && <p role="alert" className="err">{google.failed} booking(s) haven’t synced to the calendar yet. They retry automatically; you can also run a sync now.</p>}
                <button className="btn-secondary w-full" onClick={async () => { setSync("Syncing…"); try { const r = await api("/api/google/sync", "POST", {}); setSync(`Checked ${r.checked ?? 0}, re-queued ${r.requeued ?? 0}, changed in Google ${r.drift ?? 0}.`); } catch (e) { setSync((e as Error).message); } }}>Run calendar sync now</button>
                {sync && <p role="status" className="text-sm">{sync}</p>}
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
