import { json, route } from "@/lib/api";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { ApiError } from "@/lib/errors";
import { recoverStuckJobs, runDueJobs } from "@/lib/jobs";

/** Retry queue driver. Called by cron (Vercel sends `Authorization: Bearer $CRON_SECRET`). */
export const GET = route(async (req: Request) => {
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!env.cronSecret || !safeEqual(given, env.cronSecret)) throw new ApiError(401, "Unauthorized");
  await recoverStuckJobs();
  return json(await runDueJobs(50));
});
export const POST = GET;
