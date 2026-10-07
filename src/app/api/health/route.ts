import { query } from "@/lib/db";
import { json, route } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Railway health check: 200 only when the database answers. */
export const GET = route(async () => {
  await query("SELECT 1");
  return json({ ok: true });
});
