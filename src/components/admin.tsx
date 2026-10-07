"use client";
import { useCallback, useEffect, useState } from "react";

export async function api<T = any>(url: string, method = "GET", data?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: data ? { "Content-Type": "application/json" } : undefined, body: data ? JSON.stringify(data) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message ?? "Request failed");
  return j;
}

/** Loads data and exposes reload + error state. */
export function useApi<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    try { setData(await api<T>(url)); setError(""); } catch (e) { setError((e as Error).message); }
  }, [url]);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, reload };
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    CONFIRMED: ["bg-green-100 text-green-900", "✓ Confirmed"],
    PENDING: ["bg-yellow-100 text-yellow-900", "… Pending"],
    CANCELLED: ["bg-gray-200 text-gray-800", "✕ Cancelled"],
    COMPLETED: ["bg-blue-100 text-blue-900", "✔ Completed"],
    NO_SHOW: ["bg-red-100 text-red-900", "! No-show"],
  };
  const [cls, text] = map[status] ?? ["bg-gray-100", status];
  return <span className={`badge ${cls}`}>{text}</span>; // icon + text: colour is never the only signal
}

export function SyncBadge({ s }: { s: string }) {
  if (s === "NOT_REQUIRED" || s === "SYNCED") return null;
  return <span className={`badge ${s === "FAILED" ? "bg-red-100 text-red-900" : "bg-yellow-100 text-yellow-900"}`}>Calendar: {s === "FAILED" ? "sync failed, retrying" : "syncing"}</span>;
}
