"use client";
import { useState } from "react";
import { api, useApi } from "@/components/admin";

type B = { id: string; displayName: string; bio: string; photoUrl: string | null; active: boolean; bufferMin: number; googleCalendarId: string | null; googleBusySync: boolean; serviceIds: string[] };
type S = { id: string; name: string; active: boolean };
const blank = { displayName: "", bio: "", photoUrl: "", active: true, bufferMin: 0, googleCalendarId: "", googleBusySync: false, serviceIds: [] as string[] };

export function BarbersEditor() {
  const { data, error, reload } = useApi<{ barbers: B[] }>("/api/admin/barbers");
  const { data: sd } = useApi<{ services: S[] }>("/api/admin/services");
  const [edit, setEdit] = useState<any>(null);
  const [err, setErr] = useState("");

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    const { id, ...rest } = edit;
    const body = { ...rest, photoUrl: rest.photoUrl || null, googleCalendarId: rest.googleCalendarId || null };
    try {
      if (id) await api(`/api/admin/barbers/${id}`, "PATCH", body); else await api("/api/admin/barbers", "POST", body);
      setEdit(null); reload();
    } catch (x) { setErr((x as Error).message); }
  };
  const toggleSvc = (id: string) => setEdit({ ...edit, serviceIds: edit.serviceIds.includes(id) ? edit.serviceIds.filter((x: string) => x !== id) : [...edit.serviceIds, id] });

  return (
    <>
      {error && <p role="alert" className="err mb-3">{error}</p>}
      <p className="mb-3 text-sm text-gray-600">Deactivating a barber stops new bookings; existing appointments stay visible. Set weekly hours under Schedule.</p>
      <button className="btn-primary mb-4" onClick={() => setEdit({ ...blank, serviceIds: sd?.services.filter((s) => s.active).map((s) => s.id) ?? [] })}>Add barber</button>
      {edit && (
        <form onSubmit={save} className="card mb-4 grid gap-3 md:grid-cols-2">
          {err && <p role="alert" className="err md:col-span-2">{err}</p>}
          <div><label className="label" htmlFor="bn">Name</label><input id="bn" className="input" required value={edit.displayName} onChange={(e) => setEdit({ ...edit, displayName: e.target.value })} /></div>
          <div><label className="label" htmlFor="bp">Photo URL (optional)</label><input id="bp" className="input" type="url" value={edit.photoUrl ?? ""} onChange={(e) => setEdit({ ...edit, photoUrl: e.target.value })} /></div>
          <div><label className="label" htmlFor="bbuf">Buffer after each appointment (min)</label><input id="bbuf" className="input" type="number" min={0} step={5} value={edit.bufferMin} onChange={(e) => setEdit({ ...edit, bufferMin: +e.target.value })} /></div>
          <div><label className="label" htmlFor="bc">Google Calendar ID (optional)</label><input id="bc" className="input" placeholder="e.g. primary or name@gmail.com" value={edit.googleCalendarId ?? ""} onChange={(e) => setEdit({ ...edit, googleCalendarId: e.target.value })} /></div>
          <label className="flex min-h-[44px] items-center gap-2 md:col-span-2"><input type="checkbox" className="h-5 w-5" checked={edit.googleBusySync} onChange={(e) => setEdit({ ...edit, googleBusySync: e.target.checked })} /> Treat events already on this Google Calendar as busy</label>
          <fieldset className="md:col-span-2"><legend className="label">Services offered</legend>
            <div className="grid gap-1 sm:grid-cols-2">{sd?.services.filter((s) => s.active).map((s) => (
              <label key={s.id} className="flex min-h-[44px] items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={edit.serviceIds.includes(s.id)} onChange={() => toggleSvc(s.id)} /> {s.name}</label>))}</div></fieldset>
          <label className="flex min-h-[44px] items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active</label>
          <div className="flex gap-2 md:col-span-2"><button className="btn-primary">Save</button><button type="button" className="btn-secondary" onClick={() => setEdit(null)}>Cancel</button></div>
        </form>
      )}
      <ul className="space-y-2">
        {data?.barbers.map((b) => (
          <li key={b.id} className="card flex items-center justify-between gap-2">
            <p className="font-semibold">{b.displayName} {!b.active && <span className="badge bg-gray-200 text-gray-800">Inactive</span>}
              {b.googleCalendarId && <span className="badge ml-1 bg-blue-100 text-blue-900">Google Calendar</span>}</p>
            <button className="btn-secondary min-h-[40px] px-3 text-sm" onClick={() => setEdit({ ...b })}>Edit</button>
          </li>
        ))}
      </ul>
    </>
  );
}
