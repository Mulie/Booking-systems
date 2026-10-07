// Runs once when the Node server boots. On a long-lived host (Railway, Docker, VPS) this replaces cron:
// the job queue (emails, calendar sync + retries) is drained every minute and reconciled in the background.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.RUN_WORKER === "0") return;
  if (!process.env.DATABASE_URL) return;
  const { runDueJobs, recoverStuckJobs } = await import("./lib/jobs");

  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await recoverStuckJobs();
      await runDueJobs(50);
    } catch (e) {
      console.error("worker tick failed", (e as Error).message);
    } finally {
      busy = false;
    }
  };
  setTimeout(tick, 5_000).unref();
  setInterval(tick, 60_000).unref();
  console.log("[worker] background job runner started (every 60s)");
}
