import { DateTime } from "luxon";

/** Half-open interval in epoch milliseconds: [start, end). */
export type Interval = { start: number; end: number };

export type Rule = {
  weekday: number; // ISO 1=Mon..7=Sun
  startMinute: number;
  endMinute: number;
  effectiveFrom?: string | null; // yyyy-MM-dd (shop-local)
  effectiveTo?: string | null;
};

export type BarberInput = {
  id: string;
  name: string;
  bufferMin: number;
  rules: Rule[];
  timeOff: Interval[];
  bookings: Interval[]; // already includes each booking's own buffer (blocked window)
  busy: Interval[]; // external Google Calendar busy intervals (only if sync enabled)
};

export type SlotParams = {
  timezone: string;
  fromDate: string; // yyyy-MM-dd shop-local, inclusive
  toDate: string; // inclusive
  durationMin: number;
  serviceBufferMin: number;
  incrementMin: number;
  minLeadMin: number;
  horizonDays: number;
  now: number; // epoch ms
  barbers: BarberInput[];
};

export type Slot = { startsAt: number; start: string; barberId: string; barberName: string };
export type DaySlots = { date: string; slots: Slot[] };

const MIN = 60_000;

export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

export function subtract(free: Interval[], blocked: Interval[]): Interval[] {
  const b = mergeIntervals(blocked);
  const out: Interval[] = [];
  for (const f of free) {
    let cursor = f.start;
    for (const x of b) {
      if (x.end <= cursor) continue;
      if (x.start >= f.end) break;
      if (x.start > cursor) out.push({ start: cursor, end: x.start });
      cursor = Math.max(cursor, x.end);
    }
    if (cursor < f.end) out.push({ start: cursor, end: f.end });
  }
  return out;
}

/** Wall-clock minute-of-day on a local date -> instant. DST-safe (does not add absolute minutes). */
export function localMinuteToInstant(date: string, minute: number, tz: string): number {
  const d = DateTime.fromISO(date, { zone: tz });
  if (minute >= 1440) return d.plus({ days: 1 }).startOf("day").toMillis();
  return d.set({ hour: Math.floor(minute / 60), minute: minute % 60, second: 0, millisecond: 0 }).toMillis();
}

function ruleApplies(r: Rule, date: string, weekday: number): boolean {
  if (r.weekday !== weekday) return false;
  if (r.effectiveFrom && date < r.effectiveFrom) return false;
  if (r.effectiveTo && date > r.effectiveTo) return false;
  return true;
}

/** Free working intervals for one barber on one local date, before any booking is subtracted. */
export function workingIntervals(rules: Rule[], date: string, tz: string): Interval[] {
  const weekday = DateTime.fromISO(date, { zone: tz }).weekday;
  return mergeIntervals(
    rules
      .filter((r) => ruleApplies(r, date, weekday))
      .map((r) => ({
        start: localMinuteToInstant(date, r.startMinute, tz),
        end: localMinuteToInstant(date, r.endMinute, tz),
      })),
  );
}

export function computeSlots(p: SlotParams): DaySlots[] {
  const earliest = p.now + p.minLeadMin * MIN;
  const horizonEnd = DateTime.fromMillis(p.now, { zone: p.timezone })
    .plus({ days: p.horizonDays })
    .endOf("day")
    .toMillis();
  const incr = p.incrementMin * MIN;

  const result: DaySlots[] = [];
  let day = DateTime.fromISO(p.fromDate, { zone: p.timezone });
  const last = DateTime.fromISO(p.toDate, { zone: p.timezone });

  while (day <= last) {
    const date = day.toISODate()!;
    const slots: Slot[] = [];
    for (const b of p.barbers) {
      const blocked = [...b.timeOff, ...b.bookings, ...b.busy];
      const free = subtract(workingIntervals(b.rules, date, p.timezone), blocked);
      const need = (p.durationMin + Math.max(p.serviceBufferMin, b.bufferMin)) * MIN;
      for (const f of free) {
        // Candidate starts are aligned to the booking increment from local midnight.
        const dayStart = DateTime.fromISO(date, { zone: p.timezone }).startOf("day").toMillis();
        let t = dayStart + Math.ceil((f.start - dayStart) / incr) * incr;
        for (; t + need <= f.end; t += incr) {
          if (t < earliest || t > horizonEnd) continue;
          slots.push({
            startsAt: t,
            start: DateTime.fromMillis(t, { zone: p.timezone }).toFormat("HH:mm"),
            barberId: b.id,
            barberName: b.name,
          });
        }
      }
    }
    slots.sort((a, b) => a.startsAt - b.startsAt || a.barberName.localeCompare(b.barberName));
    result.push({ date, slots });
    day = day.plus({ days: 1 });
  }
  return result;
}

/** Collapse per-barber slots to one entry per start time ("any barber"), preferring the least-loaded barber. */
export function collapseForAnyBarber(days: DaySlots[], load: Map<string, number>): DaySlots[] {
  return days.map((d) => {
    const byStart = new Map<number, Slot>();
    for (const s of d.slots) {
      const cur = byStart.get(s.startsAt);
      if (!cur || (load.get(s.barberId) ?? 0) < (load.get(cur.barberId) ?? 0)) byStart.set(s.startsAt, s);
    }
    return { date: d.date, slots: [...byStart.values()].sort((a, b) => a.startsAt - b.startsAt) };
  });
}
