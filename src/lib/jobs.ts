import type { PoolClient } from "pg";
import { pool, query } from "./db";
import { loadBookingView } from "./booking";
import { renderEmail, sendEmail } from "./email";
import { calendarFor, eventIdFor } from "./google";

type Db = Pick<PoolClient, "query">;
const MAX_ATTEMPTS = 6;

/** Transactional outbox: call inside the booking transaction so jobs exist iff the booking does. */
export async function enqueue(db: Db, type: string, payload: object, dedupeKey: string, delayMs = 0) {
  await db.query(
    `INSERT INTO jobs(type, payload, dedupe_key, run_at) VALUES ($1,$2,$3, now() + ($4 || ' milliseconds')::interval)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [type, JSON.stringify(payload), dedupeKey, String(delayMs)],
  );
}

async function handleEmail(p: { bookingId: string; kind: "CONFIRMED" | "CANCELLED" | "RESCHEDULED" }) {
  const b = await loadBookingView(pool(), p.bookingId);
  if (!b || !b.customerEmail) return;
  await sendEmail(
    b.customerEmail,
    renderEmail(p.kind, {
      id: b.id,
      token: b.manageToken,
      customerName: b.customerName,
      customerEmail: b.customerEmail,
      serviceName: b.serviceName,
      barberName: b.barberName,
      startsAt: b.startsAt,
      price: b.price,
      shopName: b.shopName,
      shopAddress: b.shopAddress,
      shopPhone: b.shopPhone,
      timezone: b.timezone,
      cancellationPolicy: b.cancellationPolicy,
    }),
  );
}

async function handleCalUpsert(p: { bookingId: string }) {
  const b = await loadBookingView(pool(), p.bookingId);
  if (!b || b.status === "CANCELLED") return;
  if (!b.calendarId) {
    await query("UPDATE bookings SET calendar_sync_status='NOT_REQUIRED' WHERE id=$1", [b.id]);
    return;
  }
  const cal = await calendarFor(b.shopId);
  if (!cal) {
    await query("UPDATE bookings SET calendar_sync_status='NOT_REQUIRED' WHERE id=$1", [b.id]);
    return;
  }
  const fmt = (d: Date) => ({ dateTime: d.toISOString(), timeZone: b.timezone });
  const body = {
    id: eventIdFor(b.id), // deterministic id => retries cannot create duplicate events
    summary: `${b.serviceName} – ${b.customerName}`,
    description: [
      `Service: ${b.serviceName} (${b.durationMin} min, $${b.price})`,
      `Customer: ${b.customerName}`,
      `Phone: ${b.customerPhone}`,
      b.customerEmail && `Email: ${b.customerEmail}`,
      `Booking: ${b.id}`,
    ].filter(Boolean).join("\n"),
    start: fmt(b.startsAt),
    end: fmt(b.endsAt),
    extendedProperties: { private: { bookingId: b.id } },
  };
  try {
    await cal.events.insert({ calendarId: b.calendarId, requestBody: body });
  } catch (e: any) {
    if (e?.code === 409) {
      const { id, ...patch } = body;
      await cal.events.patch({ calendarId: b.calendarId, eventId: id, requestBody: patch });
    } else throw e;
  }
  await query(
    "UPDATE bookings SET calendar_event_id=$2, calendar_sync_status='SYNCED' WHERE id=$1",
    [b.id, eventIdFor(b.id)],
  );
  await query("INSERT INTO booking_events(booking_id,event_type,actor) VALUES ($1,'CALENDAR_SYNCED','system')", [b.id]);
}

async function handleCalDelete(p: { shopId: string; calendarId: string; eventId: string }) {
  const cal = await calendarFor(p.shopId);
  if (!cal) return;
  try {
    await cal.events.delete({ calendarId: p.calendarId, eventId: p.eventId });
  } catch (e: any) {
    if (e?.code !== 404 && e?.code !== 410) throw e;
  }
}

const handlers: Record<string, (p: any) => Promise<void>> = {
  EMAIL: handleEmail,
  CAL_UPSERT: handleCalUpsert,
  CAL_DELETE: handleCalDelete,
};

/** Claims due jobs (SKIP LOCKED => safe with concurrent runners) and runs them with exponential backoff. */
export async function runDueJobs(limit = 20): Promise<{ done: number; failed: number }> {
  const claimed = await query<{ id: string; type: string; payload: any; attempts: number }>(
    `UPDATE jobs SET status='RUNNING', attempts=attempts+1
      WHERE id IN (SELECT id FROM jobs WHERE status='PENDING' AND run_at <= now()
                    ORDER BY run_at LIMIT $1 FOR UPDATE SKIP LOCKED)
      RETURNING id, type, payload, attempts`,
    [limit],
  );
  let done = 0, failed = 0;
  for (const j of claimed) {
    try {
      const h = handlers[j.type];
      if (!h) throw new Error(`unknown job type ${j.type}`);
      await h(j.payload);
      await query("UPDATE jobs SET status='DONE', last_error=NULL WHERE id=$1", [j.id]);
      done++;
    } catch (e) {
      failed++;
      const msg = (e as Error).message.slice(0, 500);
      const final = j.attempts >= MAX_ATTEMPTS;
      await query(
        `UPDATE jobs SET status=$2, last_error=$3, run_at = now() + ($4 || ' minutes')::interval WHERE id=$1`,
        [j.id, final ? "FAILED" : "PENDING", msg, String(2 ** j.attempts)],
      );
      console.error(`job ${j.id} ${j.type} failed (attempt ${j.attempts}): ${msg}`);
      if (j.type === "CAL_UPSERT") {
        await query("UPDATE bookings SET calendar_sync_status='FAILED' WHERE id=$1", [j.payload.bookingId]);
        await query(
          "INSERT INTO booking_events(booking_id,event_type,actor,metadata) VALUES ($1,'CALENDAR_SYNC_FAILED','system',$2)",
          [j.payload.bookingId, JSON.stringify({ attempt: j.attempts, error: msg })],
        );
      }
      if (j.attempts === 3) console.error(`ALERT: job ${j.id} (${j.type}) has failed 3 times: ${msg}`);
    }
  }
  return { done, failed };
}

/** Rescues jobs stuck in RUNNING (e.g. serverless function killed mid-job). */
export async function recoverStuckJobs() {
  await query("UPDATE jobs SET status='PENDING' WHERE status='RUNNING' AND run_at < now() - interval '10 minutes'");
}

