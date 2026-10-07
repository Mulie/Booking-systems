import { z } from "zod";
import { body, json, limit, route } from "@/lib/api";
import { query } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { setSession } from "@/lib/auth";
import { ApiError } from "@/lib/errors";

const DUMMY = hashPassword("dummy-password"); // equalise timing for unknown emails

export const POST = route(async (req: Request) => {
  await limit("login", 8, 5 * 60_000);
  const d = await body(req, z.object({ email: z.string().email(), password: z.string().min(1).max(200) }));
  const rows = await query(
    "SELECT id, shop_id, role, barber_id, password_hash FROM users WHERE lower(email)=lower($1) AND status='active'",
    [d.email],
  );
  const u = rows[0];
  const ok = verifyPassword(d.password, u?.password_hash ?? DUMMY);
  if (!u || !ok) throw new ApiError(401, "Incorrect email or password");
  await setSession({ uid: u.id, shopId: u.shop_id, role: u.role, barberId: u.barber_id });
  return json({ ok: true });
});
