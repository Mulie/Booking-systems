import { google } from "googleapis";
import { query } from "./db";
import { env } from "./env";
import { decrypt } from "./crypto";
import type { Interval } from "./availability";

export const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events", // create/update/delete events
  "https://www.googleapis.com/auth/calendar.freebusy", // read busy intervals only
];

export function oauthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${env.appUrl}/api/google/callback`,
  );
}

/** Authorised calendar client for a shop, or null when Google is not configured/connected. */
export async function calendarFor(shopId: string) {
  if (!env.googleConfigured) return null;
  const rows = await query<{ refresh_token_enc: string }>(
    "SELECT refresh_token_enc FROM google_connections WHERE shop_id=$1",
    [shopId],
  );
  if (!rows.length) return null;
  const auth = oauthClient();
  auth.setCredentials({ refresh_token: decrypt(rows[0].refresh_token_enc) });
  return google.calendar({ version: "v3", auth });
}

/** External busy intervals. Never throws: on failure we log and fall back to DB-only availability. */
export async function fetchBusy(shopId: string, calendarId: string, from: number, to: number): Promise<Interval[]> {
  try {
    const cal = await calendarFor(shopId);
    if (!cal) return [];
    const r = await cal.freebusy.query({
      requestBody: {
        timeMin: new Date(from).toISOString(),
        timeMax: new Date(to).toISOString(),
        items: [{ id: calendarId }],
      },
    });
    const busy = r.data.calendars?.[calendarId]?.busy ?? [];
    return busy.map((b) => ({ start: Date.parse(b.start!), end: Date.parse(b.end!) }));
  } catch (e) {
    console.error("google freebusy failed", (e as Error).message);
    return [];
  }
}

/** Event IDs must be base32hex (0-9a-v); a UUID without dashes qualifies and makes creation idempotent. */
export const eventIdFor = (bookingId: string) => bookingId.replace(/-/g, "");
