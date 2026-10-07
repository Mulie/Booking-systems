# Barber Booking System

Mobile-first booking for a small barber shop: customers pick a service and barber (or "Any available barber"), see only valid real-time slots, and book without an account. Staff manage hours, time off, services and bookings in a simple admin. Built from the four specs in [`docs/`](docs) (PRD, architecture, UX, data/API).

**Stack:** Next.js 15 + TypeScript, Tailwind, Postgres, Google Calendar API, Resend email. Deploys on Railway (or any Node host).

## Run locally

```bash
npm install
cp .env.example .env.local        # fill in DATABASE_URL, SESSION_SECRET, etc.
npm run db:migrate
SEED_ADMIN_PASSWORD='choose-a-password' npm run db:seed   # demo shop, 2 barbers, 4 services, owner account
npm run dev                        # http://localhost:3000   staff: /admin
```

Google and email are optional locally: without `RESEND_API_KEY` emails are printed to the server log; without Google credentials calendar sync is skipped.

## Tests

```bash
npm test                                   # unit tests (availability engine, DST, buffers, ...)
TEST_DATABASE_URL=postgres://... npm test  # + integration tests against a real Postgres
```

Integration tests need an **empty throwaway database** (they TRUNCATE tables). They cover the PRD release criteria: specific-barber, any-barber and time-off-conflict scenarios; concurrent booking attempts cannot create duplicates; cancel/reschedule rules; idempotency.

## How the key requirements are met

| Requirement | Where |
|---|---|
| No double booking | Re-check inside a transaction with per-barber row locks **plus** a Postgres `EXCLUDE USING gist` constraint on active bookings (`db/migrations/001_init.sql`, `src/lib/booking.ts`) |
| Only valid slots | Pure engine `src/lib/availability.ts`: working-hour blocks (breaks = gaps) − time off − bookings(+buffer) − Google busy; lead time, horizon, increment; DST-safe |
| DB is source of truth | Google Calendar events are written *after* commit via a transactional outbox (`jobs` table) with retries/backoff; failures mark `calendar_sync_status=FAILED` without losing the booking |
| Reconciliation | `POST /api/google/sync` (admin button or cron): re-creates missing/failed events, records `CALENDAR_DRIFT` instead of overwriting when an event was moved in Google |
| Times | Stored UTC, computed/displayed in the shop timezone (`shops.timezone`) |
| Customer self-service | Unguessable `manage_token` link (email/confirmation page): cancel, reschedule, add-to-calendar (.ics), directions |
| Admin | Today (by barber), Bookings (filter, cancel/reschedule/complete/no-show, phone bookings), Schedule (weekly hours + time off), Services, Barbers, Settings (rules, Google) |
| Security | scrypt passwords, HMAC-signed httpOnly session cookie, roles (owner/admin/barber), same-origin check on admin writes, rate limits, honeypot, zod validation, AES-256-GCM encrypted Google refresh token, audit log, security headers |

## Deploy on Railway

1. Create a Railway project; add the **PostgreSQL** plugin and deploy this repo as a service (`railway.json` sets the build, health check and start command; migrations run automatically as the pre-deploy step).
2. Service variables:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (reference the plugin; use the private URL). Leave `DATABASE_SSL=0` on the private network, `1` if you use the public proxy URL.
   - `APP_URL` = your public URL (generate a Railway domain or add your custom domain) – used in emails and the Google redirect.
   - `SESSION_SECRET` (random 32+ chars), `TOKEN_ENCRYPTION_KEY` (`openssl rand -hex 32`), `CRON_SECRET`.
   - `RESEND_API_KEY`, `EMAIL_FROM`, and (optional) `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
3. Create the owner account once: `railway run npm run db:seed` with `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` set (it also adds a demo shop/services/barbers; edit or replace them in the admin).
4. Google Cloud: enable the Calendar API, create an OAuth client with redirect URI `https://<APP_URL>/api/google/callback`. In **Settings → Connect Google Calendar**, then set each barber's Calendar ID under **Barbers**.
5. Verify the email domain in Resend; replace the placeholder privacy/terms text after legal review.
6. Run the acceptance checks, then add the `/book` URL to the Google Business Profile, website and socials.

A background worker starts with the server (`src/instrumentation.ts`) and drains the email/calendar retry queue every minute, so no cron service is needed. Keep it to one replica unless you add a shared rate limiter (jobs themselves are safe across replicas). Set `RUN_WORKER=0` to disable it. Take regular Railway Postgres backups and test a restore.

## Known limits / decisions

- Customer notifications are email only (SMS, deposits, reminders are V1 in the PRD).
- Rate limiting is in-memory per instance (fine for one Railway replica); add a shared limiter if you scale out.
- Google busy intervals are checked just before the booking transaction, not inside it (no network calls while holding locks). The DB constraint still prevents app-level double booking.
- The Google Calendar and Resend integrations are implemented but were not run against the live services (no credentials here). Test them in staging with a test calendar before launch.
- Not built yet: customer deletion/anonymization UI (`anonymized_at` column exists) and a UI for creating extra staff/barber logins (insert into `users` with a hash from `src/lib/crypto.ts`).
