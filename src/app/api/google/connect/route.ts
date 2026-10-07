import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "node:crypto";
import { requireAdmin } from "@/lib/auth";
import { route } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import { env } from "@/lib/env";
import { oauthClient, SCOPES } from "@/lib/google";

export const GET = route(async () => {
  await requireAdmin({ manage: true });
  if (!env.googleConfigured) throw new ApiError(422, "Google OAuth credentials are not configured");
  const state = crypto.randomBytes(16).toString("hex");
  (await cookies()).set("g_state", state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600, path: "/api/google" });
  const url = oauthClient().generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES, state });
  return NextResponse.redirect(url);
});
