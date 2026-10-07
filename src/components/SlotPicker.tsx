"use client";
import { useEffect, useMemo, useRef, useState } from "react";

export type Slot = { start: string; startsAt: string; barberId: string; barberName: string; date?: string };
type Day = { date: string; slots: Slot[] };

const todayISO = (tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const label = (iso: string) => {
  const d = new Date(iso + "T12:00:00Z");
  return {
    dow: d.toLocaleDateString("en-CA", { weekday: "short", timeZone: "UTC" }),
    day: d.getUTCDate(),
    mon: d.toLocaleDateString("en-CA", { month: "short", timeZone: "UTC" }),
    long: d.toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }),
  };
};
const to12h = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

/**
 * Date strip + times. Auto-selects the earliest day with availability, shows only bookable times,
 * and jumps to the next available day when a chosen day has none.
 */
export function SlotPicker(props: {
  serviceId: string;
  barberId: string;
  excludeBookingId?: string;
  selected: string | null; // startsAt ISO
  onSelect: (s: Slot) => void;
  refreshKey?: number;
}) {
  const { serviceId, barberId, excludeBookingId, selected, onSelect, refreshKey } = props;
  const [days, setDays] = useState<Day[] | null>(null);
  const [tz, setTz] = useState("America/Toronto");
  const [date, setDate] = useState<string | null>(null);
  const [error, setError] = useState("");
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    setDays(null);
    setError("");
    (async () => {
      try {
        const from = todayISO(tz);
        const qs = new URLSearchParams({ serviceId, barberId, from, to: addDays(from, 62) });
        if (excludeBookingId) qs.set("excludeBookingId", excludeBookingId);
        const r = await fetch(`/api/availability?${qs}`);
        const j = await r.json();
        if (!live) return;
        if (!r.ok) return setError(j.error?.message ?? "Couldn't load times.");
        setTz(j.timezone);
        setDays(j.dates);
        const first = (j.dates as Day[]).find((d) => d.slots.length);
        setDate((cur) => (cur && (j.dates as Day[]).find((d) => d.date === cur)?.slots.length ? cur : first?.date ?? null));
      } catch {
        if (live) setError("Couldn't load times. Check your connection and try again.");
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId, barberId, excludeBookingId, refreshKey]);

  const firstAvail = useMemo(() => days?.find((d) => d.slots.length)?.date ?? null, [days]);
  const current = days?.find((d) => d.date === date);
  const nextAfter = (iso: string) => days?.find((d) => d.date > iso && d.slots.length)?.date;

  if (error) return <p role="alert" className="err">{error}</p>;
  if (!days) return <p className="py-8 text-center text-gray-600" aria-live="polite">Loading times…</p>;
  if (!firstAvail) return <p className="card text-center">No times are available right now. Please check back soon or call the shop.</p>;

  // Only show the next ~3 weeks in the strip; later days are reachable via "Next available".
  const strip = days.slice(0, 28);
  return (
    <div>
      <p className="mb-2 text-sm text-gray-600">Earliest availability: <strong>{label(firstAvail).long}</strong></p>
      <div ref={stripRef} role="listbox" aria-label="Choose a day" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2">
        {strip.map((d) => {
          const l = label(d.date);
          const disabled = d.slots.length === 0;
          const active = d.date === date;
          return (
            <button
              key={d.date}
              role="option"
              aria-selected={active}
              aria-disabled={disabled}
              disabled={disabled}
              onClick={() => setDate(d.date)}
              className={`flex min-h-[64px] min-w-[56px] shrink-0 flex-col items-center justify-center rounded-lg border px-2 py-1 text-sm
                ${active ? "border-brand bg-brand text-white" : disabled ? "border-gray-200 bg-gray-100 text-gray-400 line-through" : "border-gray-300 bg-white hover:border-amber-700"}`}
            >
              <span className="text-xs">{l.dow}</span>
              <span className="text-lg font-semibold">{l.day}</span>
              <span className="text-xs">{d.date === firstAvail ? "Earliest" : l.mon}</span>
            </button>
          );
        })}
      </div>

      <h3 className="mb-2 mt-4 font-semibold" aria-live="polite">{date ? label(date).long : ""}</h3>
      {current && current.slots.length > 0 ? (
        <ul className="grid grid-cols-3 gap-2">
          {current.slots.map((s) => (
            <li key={s.startsAt}>
              <button
                onClick={() => onSelect({ ...s, date: current.date })}
                aria-pressed={selected === s.startsAt}
                className={`min-h-[44px] w-full rounded-lg border px-2 text-sm font-medium ${selected === s.startsAt ? "border-brand bg-brand text-white" : "border-gray-300 bg-white hover:border-amber-700"}`}
              >
                {to12h(s.start)}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="card text-center">
          <p>No times available on this day. See the next available day.</p>
          {date && nextAfter(date) && (
            <button className="btn-secondary mt-3" onClick={() => setDate(nextAfter(date)!)}>Go to {label(nextAfter(date)!).long}</button>
          )}
        </div>
      )}
      <p className="mt-3 text-xs text-gray-500">Times are shown in shop time ({tz.replace("_", " ")}).</p>
    </div>
  );
}

export { to12h, label as dateLabel };
