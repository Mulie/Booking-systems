import { query } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { env } from "@/lib/env";
import { SettingsEditor } from "./SettingsEditor";

export const dynamic = "force-dynamic";

export default async function Settings({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const s = (await getSession())!;
  const { google } = await searchParams;
  const conn = (await query("SELECT connected_at FROM google_connections WHERE shop_id=$1", [s.shopId]))[0];
  const failed = (await query("SELECT count(*)::int n FROM bookings WHERE shop_id=$1 AND calendar_sync_status='FAILED' AND status IN ('PENDING','CONFIRMED')", [s.shopId]))[0].n;
  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">Settings</h1>
      <SettingsEditor google={{ configured: env.googleConfigured, connected: !!conn, justConnected: google === "connected", failed }} />
    </>
  );
}
