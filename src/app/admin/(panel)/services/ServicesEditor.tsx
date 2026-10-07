"use client";
import { useState } from "react";
import { api, useApi } from "@/components/admin";

type S = { id: string; name: string; description: string; durationMin: number; bufferMin: number; price: number; active: boolean };
const blank = { name: "", description: "", durationMin: 30, bufferMin: 0, price: 0, active: true };

export function ServicesEditor() {
  const { data, error, reload } = useApi<{ services: S[] }>("/api/admin/services");
  const [edit, setEdit] = useState<(Partial<S> & typeof blank) | null>(null);
  const [err, setErr] = useState("");

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    try {
      const { id, ...body } = edit as S;
      if (id) await api(`/api/admin/services/${id}`, "PATCH", body); else await api("/api/admin/services", "POST", body);
      setEdit(null); reload();
    } catch (x) { setErr((x as Error).message); }
  };
  const toggle = async (s: S) => { await api(`/api/admin/services/${s.id}`, "PATCH", { active: !s.active }); reload(); };

  return (
    <>
      {error && <p role="alert" className="err mb-3">{error}</p>}
      <p className="mb-3 text-sm text-gray-600">Changes apply to new bookings only. Existing appointments keep their original duration and price.</p>
      <button className="btn-primary mb-4" onClick={() => setEdit({ ...blank })}>Add service</button>
      {edit && (
        <form onSubmit={save} className="card mb-4 grid gap-3 md:grid-cols-2">
          {err && <p role="alert" className="err md:col-span-2">{err}</p>}
          <div><label className="label" htmlFor="sn">Name</label><input id="sn" className="input" required value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
          <div><label className="label" htmlFor="sd">Description</label><input id="sd" className="input" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></div>
          <div><label className="label" htmlFor="sm">Duration (minutes)</label><input id="sm" className="input" type="number" min={5} step={5} required value={edit.durationMin} onChange={(e) => setEdit({ ...edit, durationMin: +e.target.value })} /></div>
          <div><label className="label" htmlFor="sb">Buffer after (minutes)</label><input id="sb" className="input" type="number" min={0} step={5} value={edit.bufferMin} onChange={(e) => setEdit({ ...edit, bufferMin: +e.target.value })} /></div>
          <div><label className="label" htmlFor="sp">Price ($)</label><input id="sp" className="input" type="number" min={0} step="0.01" required value={edit.price} onChange={(e) => setEdit({ ...edit, price: +e.target.value })} /></div>
          <label className="flex min-h-[44px] items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active (customers can book it)</label>
          <div className="flex gap-2 md:col-span-2"><button className="btn-primary">Save</button><button type="button" className="btn-secondary" onClick={() => setEdit(null)}>Cancel</button></div>
        </form>
      )}
      <ul className="space-y-2">
        {data?.services.map((s) => (
          <li key={s.id} className="card flex flex-wrap items-center justify-between gap-2">
            <div><p className="font-semibold">{s.name} {!s.active && <span className="badge bg-gray-200 text-gray-800">Inactive</span>}</p>
              <p className="text-sm text-gray-600">{s.durationMin} min{s.bufferMin ? ` + ${s.bufferMin} buffer` : ""} · ${s.price.toFixed(2)}</p></div>
            <div className="flex gap-2"><button className="btn-secondary min-h-[40px] px-3 text-sm" onClick={() => setEdit(s as any)}>Edit</button>
              <button className="btn-secondary min-h-[40px] px-3 text-sm" onClick={() => toggle(s)}>{s.active ? "Deactivate" : "Activate"}</button></div>
          </li>
        ))}
      </ul>
    </>
  );
}
