import { cookies, headers } from "next/headers";
import { env } from "./env";
import { sign, verifySigned } from "./crypto";
import { ApiError } from "./errors";
import { query } from "./db";

export type Session = {
  uid: string;
  shopId: string;
  role: "owner" | "admin" | "barber";
  barberId: string | null;
  exp: number;
};

const COOKIE = "session";
const TTL_S = 60 * 60 * 12;

export async function setSession(s: Omit<Session, "exp">) {
  const exp = Math.floor(Date.now() / 1000) + TTL_S;
  (await cookies()).set(COOKIE, sign({ ...s, exp }, env.sessionSecret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TTL_S,
  });
}

export async function clearSession() {
  (await cookies()).delete(COOKIE);
}

export async function getSession(): Promise<Session | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const s = verifySigned<Session>(raw, env.sessionSecret);
  if (!s || s.exp < Date.now() / 1000) return null;
  // Re-check the user is still active so disabling an account takes effect immediately.
  const rows = await query("SELECT 1 FROM users WHERE id=$1 AND status='active'", [s.uid]);
  return rows.length ? s : null;
}

/** For API routes. Throws 401/403. Mutating requests must be same-origin (CSRF defence in depth). */
export async function requireAdmin(opts: { manage?: boolean; mutating?: boolean } = {}): Promise<Session> {
  const s = await getSession();
  if (!s) throw new ApiError(401, "Sign in required");
  if (opts.mutating) {
    const h = await headers();
    const origin = h.get("origin");
    if (origin && new URL(origin).host !== h.get("host")) throw new ApiError(403, "Cross-origin request blocked");
  }
  if (opts.manage && s.role === "barber") throw new ApiError(403, "Not authorized");
  return s;
}

/** Barbers may only touch their own schedule. */
export function assertBarberScope(s: Session, barberId: string) {
  if (s.role === "barber" && s.barberId !== barberId) throw new ApiError(403, "Not authorized");
}
