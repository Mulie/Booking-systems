import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { collapseForAnyBarber, computeSlots, subtract, type BarberInput } from "@/lib/availability";

const TZ = "America/Toronto";
const at = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toMillis();
const barber = (o: Partial<BarberInput> = {}): BarberInput => ({
  id: "b1", name: "Alex", bufferMin: 0,
  // Mon-Sun 09:00-12:00 and 13:00-17:00 (lunch break = the gap)
  rules: [1, 2, 3, 4, 5, 6, 7].flatMap((weekday) => [
    { weekday, startMinute: 540, endMinute: 720 },
    { weekday, startMinute: 780, endMinute: 1020 },
  ]),
  timeOff: [], bookings: [], busy: [], ...o,
});
const base = {
  timezone: TZ, fromDate: "2026-10-12", toDate: "2026-10-12", durationMin: 30, serviceBufferMin: 0,
  incrementMin: 15, minLeadMin: 120, horizonDays: 30, now: at("2026-10-01T08:00"),
};
const starts = (d: ReturnType<typeof computeSlots>) => d[0].slots.map((s) => s.start);

describe("availability engine", () => {
  it("generates slots on the increment, respecting breaks (FR-05)", () => {
    const s = starts(computeSlots({ ...base, barbers: [barber()] }));
    expect(s[0]).toBe("09:00");
    expect(s).toContain("11:30");
    expect(s).not.toContain("11:45"); // 30 min would cross into lunch
    expect(s).not.toContain("12:00");
    expect(s).toContain("13:00");
    expect(s.at(-1)).toBe("16:30");
  });

  it("only offers a slot if the whole service fits (FR-03)", () => {
    const s = starts(computeSlots({ ...base, durationMin: 60, barbers: [barber()] }));
    expect(s).toContain("11:00");
    expect(s).not.toContain("11:15");
    expect(s.at(-1)).toBe("16:00");
  });

  it("removes overlapping bookings incl. their buffer (FR-04)", () => {
    const booked = { start: at("2026-10-12T10:00"), end: at("2026-10-12T10:30") };
    const s = starts(computeSlots({ ...base, barbers: [barber({ bookings: [booked] })] }));
    expect(s).toContain("09:30");
    expect(s).not.toContain("09:45"); // 09:45-10:15 overlaps
    expect(s).not.toContain("10:15");
    expect(s).toContain("10:30");
  });

  it("applies service buffer after the appointment", () => {
    const booked = { start: at("2026-10-12T10:00"), end: at("2026-10-12T10:30") };
    const s = starts(computeSlots({ ...base, serviceBufferMin: 15, barbers: [barber({ bookings: [booked] })] }));
    expect(s).toContain("09:15"); // 09:15-09:45 + 15 buffer = 10:00 exactly
    expect(s).not.toContain("09:30");
  });

  it("time off overrides recurring availability (FR-06)", () => {
    const off = { start: at("2026-10-12T00:00"), end: at("2026-10-13T00:00") };
    expect(computeSlots({ ...base, barbers: [barber({ timeOff: [off] })] })[0].slots).toHaveLength(0);
    const part = { start: at("2026-10-12T09:00"), end: at("2026-10-12T11:00") };
    expect(starts(computeSlots({ ...base, barbers: [barber({ timeOff: [part] })] }))[0]).toBe("11:00");
  });

  it("treats Google busy intervals as unavailable", () => {
    const busy = { start: at("2026-10-12T09:00"), end: at("2026-10-12T10:00") };
    expect(starts(computeSlots({ ...base, barbers: [barber({ busy: [busy] })] }))[0]).toBe("10:00");
  });

  it("enforces minimum lead time and booking horizon", () => {
    const now = at("2026-10-12T08:30");
    const s = starts(computeSlots({ ...base, now, barbers: [barber()] }));
    expect(s[0]).toBe("10:30"); // now + 2h
    const far = computeSlots({ ...base, fromDate: "2026-11-20", toDate: "2026-11-20", barbers: [barber()] });
    expect(far[0].slots).toHaveLength(0); // > 30 days out
  });

  it("never offers past times", () => {
    const now = at("2026-10-12T20:00");
    expect(computeSlots({ ...base, now, barbers: [barber()] })[0].slots).toHaveLength(0);
  });

  it("respects effective dates and weekdays", () => {
    const b = barber({ rules: [{ weekday: 1, startMinute: 540, endMinute: 600, effectiveFrom: "2026-10-19" }] });
    expect(computeSlots({ ...base, barbers: [b] })[0].slots).toHaveLength(0); // Mon 10/12 before effective
    expect(computeSlots({ ...base, fromDate: "2026-10-19", toDate: "2026-10-19", barbers: [b] })[0].slots).toHaveLength(3);
    expect(computeSlots({ ...base, fromDate: "2026-10-20", toDate: "2026-10-20", barbers: [b] })[0].slots).toHaveLength(0);
  });

  it("is DST-safe: spring-forward day keeps wall-clock hours", () => {
    // 2027-03-14: 02:00 jumps to 03:00 in Toronto. Rule 01:00-05:00 local.
    const b = barber({ rules: [{ weekday: 7, startMinute: 60, endMinute: 300 }] });
    const r = computeSlots({
      ...base, now: at("2027-03-01T08:00"), fromDate: "2027-03-14", toDate: "2027-03-14", barbers: [b], horizonDays: 60,
    });
    // Wall clock skips 02:00-03:00, but real time is contiguous: 3h of working time => 11 half-hour slots.
    expect(r[0].slots.map((x) => x.start)).toEqual([
      "01:00", "01:15", "01:30", "01:45", "03:00", "03:15", "03:30", "03:45", "04:00", "04:15", "04:30",
    ]);
  });

  it("DST fall-back day does not duplicate or lose slots", () => {
    // 2026-11-01: 02:00 EDT -> 01:00 EST. Rule 09:00-10:00 is unaffected.
    const b = barber({ rules: [{ weekday: 7, startMinute: 540, endMinute: 600 }] });
    const r = computeSlots({ ...base, now: at("2026-10-20T08:00"), fromDate: "2026-11-01", toDate: "2026-11-01", barbers: [b] });
    expect(r[0].slots.map((x) => x.start)).toEqual(["09:00", "09:15", "09:30"]);
  });

  it("any-barber: one slot per start time, least-loaded barber wins", () => {
    const a = barber({ id: "a", name: "Alex" });
    const s = barber({ id: "s", name: "Sam", rules: [{ weekday: 1, startMinute: 600, endMinute: 660 }] });
    const days = computeSlots({ ...base, barbers: [a, s] });
    const collapsed = collapseForAnyBarber(days, new Map([["a", 5], ["s", 1]]));
    const ten = collapsed[0].slots.find((x) => x.start === "10:00")!;
    expect(ten.barberId).toBe("s");
    expect(collapsed[0].slots.filter((x) => x.start === "10:00")).toHaveLength(1);
    expect(collapsed[0].slots.find((x) => x.start === "09:00")!.barberId).toBe("a");
  });

  it("subtract handles adjacent/overlapping blockers", () => {
    expect(subtract([{ start: 0, end: 100 }], [{ start: 10, end: 20 }, { start: 15, end: 30 }, { start: 90, end: 120 }]))
      .toEqual([{ start: 0, end: 10 }, { start: 30, end: 90 }]);
  });
});
