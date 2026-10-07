import { json, route } from "@/lib/api";
import { clearSession } from "@/lib/auth";

export const POST = route(async () => {
  await clearSession();
  return json({ ok: true });
});
