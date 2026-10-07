import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { pool, query } from "@/lib/db";
import { cancelBooking, createBooking, rescheduleBooking } from "@/lib/booking";
import { publicAvailability } from "@/lib/slots";
import { runDueJobs } from "@/lib/jobs";
import { ApiError } from "@/lib/errors";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const TZ = "America/Toronto";
const NOW = DateTime.fromISO("2026-10-01T08:00", { zone: TZ }).toMillis();
const at = (d: string) => new Date(DateTime.fromISO(d, { zone: TZ }).toMillis());
// 2026-10-14 is a Wednesday
const SLOT = "2026-10-14T10:00";

let shopId: string, svc: string, alex: string, sam: string;

async function reset() {
  await query("TRUNCATE jobs, booking_events, booking_failures, bookings, customers, time_off, availability_rules, barber_services, barbers, services, users, shops CASCADE");
  shopId = (await query("INSERT INTO shops(name,timezone,address) VALUES ('Test Cuts',$1,'1 Main St') RETURNING id", [TZ]))[0].id;
  svc = (await query("INSERT INTO services(shop_id,name,duration_min,price) VALUES ($1,'Haircut',30,35) RETURNING id", [shopId]))[0].id;
  const mk = async (n: string) => {
    const id = (await query("INSERT INTO barbers(shop_id,display_name) VALUES ($1,$2) RETURNING id", [shopId, n]))[0].id;
    await query("INSERT INTO barber_services(barber_id,service_id) VALUES ($1,$2)", [id, svc]);
    for (let d = 1; d <= 6; d++) await query("INSERT INTO availability_rules(barber_id,weekday,start_minute,end_minute) VALUES ($1,$2,540,1020)", [id, d]);
    return id as string;
  };
  alex = await mk("Alex");
  sam = await mk("Sam");
}

const cust = (n = 1) => ({ name: `Cust ${n}`, phone: `416555${String(1000 + n)}`, email: `c${n}@example.com` });
const book = (o: Partial<Parameters<typeof createBooking>[0]> = {}) =>
  createBooking({ shopId, serviceId: svc, barberId: alex, startsAt: at(SLOT), customer: cust(), now: NOW, ...o });
const avail = async (barberId: string | "any") =>
  (await publicAvailability(pool(), shopId, svc, barberId, "2026-10-14", "2026-10-14")).dates[0]?.slots ?? [];

run("booking service (real Postgres)", () => {
  beforeAll(async () => {
    const { execSync } = await import("node:child_process");
    execSync("node scripts/migrate.mjs", { env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL } });
  });
  beforeEach(reset);
  afterAll(() => pool().end());

  // The publicAvailability helper uses wall-clock now; the test dates are in the future relative to the real clock only
  // when run before them, so availability assertions go through findSlots-equivalent createBooking behaviour instead.

  it("E2E 1: specific barber booking succeeds and blocks the slot", async () => {
    const b = await book();
    expect(b.status).toBe("CONFIRMED");
    expect(b.barberName).toBe("Alex");
    await expect(book({ customer: cust(2) })).rejects.toMatchObject({ status: 409 });
    // Sam is still free at that time
    expect((await book({ barberId: sam, customer: cust(3) })).barberName).toBe("Sam");
  });

  it("E2E 2: any barber spreads load, then runs out", async () => {
    const a = await book({ barberId: "any", customer: cust(1) });
    const b = await book({ barberId: "any", customer: cust(2) });
    expect(new Set([a.barberId, b.barberId]).size).toBe(2);
    await expect(book({ barberId: "any", customer: cust(3) })).rejects.toMatchObject({ status: 409 });
  });

  it("E2E 3: time-off conflict blocks booking", async () => {
    await query("INSERT INTO time_off(barber_id,starts_at,ends_at,reason) VALUES ($1,$2,$3,'dentist')", [alex, at("2026-10-14T09:30"), at("2026-10-14T11:00")]);
    await expect(book()).rejects.toMatchObject({ status: 409 });
    // any-barber falls through to Sam
    expect((await book({ barberId: "any" })).barberName).toBe("Sam");
  });

  it("concurrent attempts on one slot create exactly one booking", async () => {
    const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => book({ customer: cust(i + 1) })));
    const ok = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(rejected.every((r) => r.reason instanceof ApiError && r.reason.status === 409)).toBe(true);
    const n = await query("SELECT count(*)::int n FROM bookings WHERE barber_id=$1 AND status='CONFIRMED'", [alex]);
    expect(n[0].n).toBe(1);
  });

  it("concurrent 'any barber' attempts fill both barbers and no more", async () => {
    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => book({ barberId: "any", customer: cust(i + 1) })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    const dup = await query("SELECT barber_id, count(*)::int n FROM bookings GROUP BY barber_id");
    expect(dup.every((r) => r.n === 1)).toBe(true);
  });

  it("overlapping (not just identical) concurrent starts are rejected", async () => {
    const starts = ["2026-10-14T10:00", "2026-10-14T10:15", "2026-10-14T09:45", "2026-10-14T10:00"];
    const r = await Promise.allSettled(starts.map((s, i) => book({ startsAt: at(s), customer: cust(i + 1) })));
    // 09:45 and 10:15 are adjacent (allowed together); 10:00 conflicts with both. Never any overlap.
    const ok = r.filter((x) => x.status === "fulfilled").length;
    expect(ok === 1 || ok === 2).toBe(true);
    const rows = await query("SELECT starts_at, ends_at FROM bookings ORDER BY starts_at");
    for (let k = 1; k < rows.length; k++) expect(+rows[k].starts_at).toBeGreaterThanOrEqual(+rows[k - 1].ends_at);
  });

  it("database exclusion constraint is a hard backstop (bypassing the app)", async () => {
    const b = await book();
    const c = (await query("SELECT customer_id FROM bookings WHERE id=$1", [b.id]))[0].customer_id;
    await expect(
      query(
        `INSERT INTO bookings(shop_id,barber_id,service_id,customer_id,starts_at,ends_at,blocked_until,duration_min,price)
         VALUES ($1,$2,$3,$4,$5,$6,$6,30,35)`,
        [shopId, alex, svc, c, at("2026-10-14T10:15"), at("2026-10-14T10:45")],
      ),
    ).rejects.toMatchObject({ code: "23P01" });
  });

  it("idempotency key returns the same booking", async () => {
    const a = await book({ idempotencyKey: "abc" });
    const b = await book({ idempotencyKey: "abc" });
    expect(b.id).toBe(a.id);
    expect((await query("SELECT count(*)::int n FROM bookings"))[0].n).toBe(1);
  });

  it("business rules: lead time, past, inactive service/barber", async () => {
    await expect(book({ startsAt: at("2026-10-01T09:00") })).rejects.toMatchObject({ status: 422 }); // <2h lead
    await expect(book({ startsAt: at("2026-09-01T09:00") })).rejects.toMatchObject({ status: 422 });
    await expect(book({ startsAt: at("2026-12-14T10:00") })).rejects.toMatchObject({ status: 422 }); // beyond horizon
    await query("UPDATE barbers SET active=false WHERE id=$1", [alex]);
    await expect(book()).rejects.toMatchObject({ status: 422 });
    await query("UPDATE services SET active=false WHERE id=$1", [svc]);
    await expect(book({ barberId: sam })).rejects.toMatchObject({ status: 422 });
  });

  it("rejects times outside working hours and off-grid starts", async () => {
    await expect(book({ startsAt: at("2026-10-14T08:00") })).rejects.toMatchObject({ status: 409 });
    await expect(book({ startsAt: at("2026-10-14T10:07") })).rejects.toMatchObject({ status: 409 });
    await expect(book({ startsAt: at("2026-10-18T10:00") })).rejects.toMatchObject({ status: 409 }); // Sunday
  });

  it("cancel frees the slot; customer needs the right token and respects cutoff", async () => {
    const b = await book();
    await expect(cancelBooking(b.id, { kind: "customer", token: "wrong" }, NOW)).rejects.toMatchObject({ status: 404 });
    const c = await cancelBooking(b.id, { kind: "customer", token: b.manageToken }, NOW);
    expect(c.status).toBe("CANCELLED");
    await expect(cancelBooking(b.id, { kind: "customer", token: b.manageToken }, NOW)).rejects.toMatchObject({ status: 422 });
    expect((await book({ customer: cust(2) })).status).toBe("CONFIRMED");
    // within 12h cutoff
    const late = await book({ barberId: sam, startsAt: at("2026-10-14T10:00"), customer: cust(3) });
    await expect(
      cancelBooking(late.id, { kind: "customer", token: late.manageToken }, at("2026-10-14T05:00").getTime()),
    ).rejects.toMatchObject({ status: 422 });
    expect((await cancelBooking(late.id, { kind: "admin", userId: "u", shopId }, at("2026-10-14T05:00").getTime())).status).toBe("CANCELLED");
  });

  it("reschedule moves the booking, rejects taken times, and frees the old time", async () => {
    const a = await book();
    const other = await book({ startsAt: at("2026-10-14T11:00"), customer: cust(2) });
    const tok = { kind: "customer" as const, token: a.manageToken };
    await expect(rescheduleBooking(a.id, tok, at("2026-10-14T11:00"), { now: NOW })).rejects.toMatchObject({ status: 409 });
    const moved = await rescheduleBooking(a.id, tok, at("2026-10-14T10:15"), { now: NOW }); // overlaps own old window: allowed
    expect(+moved.startsAt).toBe(+at("2026-10-14T10:15"));
    const again = await book({ startsAt: at("2026-10-14T10:00"), barberId: alex, customer: cust(3) }).catch((e) => e);
    expect(again).toMatchObject({ status: 409 }); // 10:00-10:30 overlaps 10:15-10:45
    expect(other.status).toBe("CONFIRMED");
  });

  it("service duration changes do not mutate existing bookings", async () => {
    const b = await book();
    await query("UPDATE services SET duration_min=60 WHERE id=$1", [svc]);
    const row = (await query("SELECT duration_min, ends_at, starts_at FROM bookings WHERE id=$1", [b.id]))[0];
    expect(row.duration_min).toBe(30);
    expect(+row.ends_at - +row.starts_at).toBe(30 * 60_000);
  });

  it("creates outbox jobs and sends the confirmation email", async () => {
    const b = await book();
    const jobs = await query("SELECT type, status FROM jobs WHERE payload->>'bookingId'=$1", [b.id]);
    expect(jobs).toEqual([{ type: "EMAIL", status: "PENDING" }]);
    expect((await runDueJobs()).done).toBe(1);
    expect((await query("SELECT status FROM jobs"))[0].status).toBe("DONE");
  });

  it("logs booking events", async () => {
    const b = await book();
    await cancelBooking(b.id, { kind: "admin", userId: "u1", shopId }, NOW);
    const ev = await query("SELECT event_type, actor FROM booking_events WHERE booking_id=$1 ORDER BY id", [b.id]);
    expect(ev.map((e) => e.event_type)).toEqual(["CREATED", "CANCELLED"]);
    expect(ev[1].actor).toBe("admin:u1");
  });

  it("availability API excludes booked slots and honours 'any'", async () => {
    // Relative to the real clock: pick a Wednesday ~10 days ahead.
    const d = DateTime.now().setZone(TZ).plus({ days: 10 });
    const wed = d.plus({ days: (3 - d.weekday + 7) % 7 });
    const date = wed.toISODate()!;
    const start = wed.set({ hour: 10, minute: 0, second: 0, millisecond: 0 }).toJSDate();
    const get = async (b: string): Promise<{ start: string }[]> => (await publicAvailability(pool(), shopId, svc, b, date, date)).dates[0].slots;
    expect((await get(alex)).map((s) => s.start)).toContain("10:00");
    await createBooking({ shopId, serviceId: svc, barberId: alex, startsAt: start, customer: cust() });
    expect((await get(alex)).map((s) => s.start)).not.toContain("10:00");
    expect((await get("any")).map((s) => s.start)).toContain("10:00"); // Sam still free
    await createBooking({ shopId, serviceId: svc, barberId: sam, startsAt: start, customer: cust(2) });
    expect((await get("any")).map((s) => s.start)).not.toContain("10:00");
  });
});

it("encryption round-trips and rejects tampering", async () => {
  const { encrypt, decrypt, hashPassword, verifyPassword } = await import("@/lib/crypto");
  const blob = encrypt("refresh-token-xyz");
  expect(blob).not.toContain("refresh");
  expect(decrypt(blob)).toBe("refresh-token-xyz");
  expect(() => decrypt(blob.slice(0, -2) + "AA")).toThrow();
  const h = hashPassword("pw");
  expect(verifyPassword("pw", h)).toBe(true);
  expect(verifyPassword("nope", h)).toBe(false);
});
