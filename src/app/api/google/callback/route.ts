import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireAdmin } from "@/lib/auth";
import { route } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import { env } from "@/lib/env";
import { encrypt, safeEqual } from "@/lib/crypto";
import { query } from "@/lib/db";
import { oauthClient } from "@/lib/google";
import { audit } from "@/lib/audit";

export const GET = route(async (req: Request) => {
  const s = await requireAdmin({ manage: true });
  const u = new URL(req.url);
  const expected = (await cookies()).get("g_state")?.value ?? "";
  const state = u.searchParams.get("state") ?? "";
  if (!expected || !safeEqual(expected, state)) throw new ApiError(400, "Invalid OAuth state");
  const code = u.searchParams.get("code");
  if (!code) throw new ApiError(400, "Google authorisation was cancelled");
  const { tokens } = await oauthClient().getToken(code);
  if (!tokens.refresh_token) throw new ApiError(422, "Google did not return a refresh token; remove the app's access in your Google account and try again");
  // Refresh token stays server-side, encrypted at rest; it is never sent to the browser.
  await query(
    `INSERT INTO google_connections(shop_id, refresh_token_enc) VALUES ($1,$2)
     ON CONFLICT (shop_id) DO UPDATE SET refresh_token_enc=EXCLUDED.refresh_token_enc, connected_at=now()`,
    [s.shopId, encrypt(tokens.refresh_token)],
  );
  await audit(s, "google.connect", "shop", s.shopId);
  const res = NextResponse.redirect(`${env.appUrl}/admin/settings?google=connected`);
  res.cookies.delete({ name: "g_state", path: "/api/google" });
  return res;
});
