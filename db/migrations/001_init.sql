-- Barber booking system: initial schema. All timestamps are UTC (timestamptz).
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE booking_status AS ENUM ('PENDING','CONFIRMED','CANCELLED','COMPLETED','NO_SHOW');
CREATE TYPE booking_source AS ENUM ('GOOGLE','WEBSITE','ADMIN','OTHER');
CREATE TYPE user_role AS ENUM ('owner','admin','barber');
CREATE TYPE sync_status AS ENUM ('NOT_REQUIRED','PENDING','SYNCED','FAILED');

CREATE TABLE shops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'America/Toronto',
  address text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  cancellation_policy text NOT NULL DEFAULT 'Free cancellation up to 12 hours before your appointment.',
  slot_increment_min int NOT NULL DEFAULT 15 CHECK (slot_increment_min BETWEEN 5 AND 120),
  min_lead_min int NOT NULL DEFAULT 120 CHECK (min_lead_min >= 0),
  horizon_days int NOT NULL DEFAULT 30 CHECK (horizon_days BETWEEN 1 AND 365),
  cancel_cutoff_hours int NOT NULL DEFAULT 12 CHECK (cancel_cutoff_hours >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE barbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id),
  display_name text NOT NULL,
  bio text NOT NULL DEFAULT '',
  photo_url text,
  active boolean NOT NULL DEFAULT true,
  buffer_min int NOT NULL DEFAULT 0 CHECK (buffer_min >= 0),
  google_calendar_id text,           -- calendar events are written to (null = no sync)
  google_busy_sync boolean NOT NULL DEFAULT false, -- treat external busy events as unavailable
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX barbers_active_name ON barbers (shop_id, lower(display_name)) WHERE active;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id),
  role user_role NOT NULL DEFAULT 'admin',
  email text NOT NULL,
  password_hash text NOT NULL,
  barber_id uuid REFERENCES barbers(id), -- set for role 'barber'
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, email)
);

CREATE TABLE services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  duration_min int NOT NULL CHECK (duration_min > 0),
  buffer_min int NOT NULL DEFAULT 0 CHECK (buffer_min >= 0),
  price numeric(8,2) NOT NULL CHECK (price >= 0),
  active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX services_active_name ON services (shop_id, lower(name)) WHERE active;

CREATE TABLE barber_services (
  barber_id uuid NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (barber_id, service_id)
);

-- Recurring weekly working intervals. Several rows per weekday express breaks
-- (e.g. 09:00-12:00 and 13:00-17:00). weekday is ISO: 1=Monday .. 7=Sunday.
CREATE TABLE availability_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id uuid NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
  weekday int NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_minute int NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute int NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
  effective_from date,
  effective_to date,
  CHECK (end_minute > start_minute)
);
CREATE INDEX availability_rules_barber ON availability_rules (barber_id, weekday);

CREATE TABLE time_off (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id uuid NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text NOT NULL DEFAULT '',
  CHECK (ends_at > starts_at)
);
CREATE INDEX time_off_barber_start ON time_off (barber_id, starts_at);

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id),
  name text NOT NULL,
  phone text NOT NULL,            -- normalised digits (+ prefix kept)
  email text,
  consent_contact_at timestamptz, -- agreed to be contacted about the appointment
  anonymized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, phone)
);

CREATE TABLE bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id),
  barber_id uuid NOT NULL REFERENCES barbers(id),
  service_id uuid NOT NULL REFERENCES services(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  -- end of the blocked window = ends_at + buffer. Stored (not computed) so it can be indexed/constrained.
  blocked_until timestamptz NOT NULL,
  duration_min int NOT NULL CHECK (duration_min > 0), -- snapshot: later service edits do not mutate history
  price numeric(8,2) NOT NULL CHECK (price >= 0),
  status booking_status NOT NULL DEFAULT 'CONFIRMED',
  source booking_source NOT NULL DEFAULT 'WEBSITE',
  manage_token text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  idempotency_key text,
  calendar_event_id text,
  calendar_sync_status sync_status NOT NULL DEFAULT 'NOT_REQUIRED',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at AND blocked_until >= ends_at),
  -- Hard guarantee: no two active bookings for one barber may overlap.
  CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
    barber_id WITH =,
    tstzrange(starts_at, blocked_until) WITH &&
  ) WHERE (status IN ('PENDING','CONFIRMED'))
);
CREATE INDEX bookings_lookup ON bookings (shop_id, barber_id, starts_at, status);
CREATE UNIQUE INDEX bookings_idem ON bookings (shop_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE booking_events (
  id bigserial PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  event_type text NOT NULL,   -- CREATED, CANCELLED, RESCHEDULED, FAILED, CALENDAR_SYNCED, ...
  actor text NOT NULL,        -- customer | admin:<user id> | system
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_events_booking ON booking_events (booking_id);

-- Failed attempts have no booking row, so they are logged here too.
CREATE TABLE booking_failures (
  id bigserial PRIMARY KEY,
  shop_id uuid NOT NULL,
  reason text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sync_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id uuid NOT NULL UNIQUE REFERENCES barbers(id) ON DELETE CASCADE,
  calendar_id text NOT NULL,
  last_synced_at timestamptz,
  sync_token text,
  status text NOT NULL DEFAULT 'OK',
  last_error text
);

-- One Google account per shop; refresh token is AES-256-GCM encrypted by the app.
CREATE TABLE google_connections (
  shop_id uuid PRIMARY KEY REFERENCES shops(id),
  account_email text,
  refresh_token_enc text NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now()
);

-- Background work (calendar + email) with retry.
CREATE TABLE jobs (
  id bigserial PRIMARY KEY,
  type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','DONE','FAILED')),
  attempts int NOT NULL DEFAULT 0,
  run_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  dedupe_key text UNIQUE,   -- idempotency: one job per (type, booking, version)
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_due ON jobs (status, run_at);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  shop_id uuid NOT NULL,
  user_id uuid,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
