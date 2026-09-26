/**
 * In-process scheduler for time-based workflows.
 *
 * WHY THIS EXISTS. /api/cron/workflows has been in the codebase since the
 * workflow engine shipped, waiting for an EventBridge rule that was never
 * created. A production check on 2026-09-26 found the consequence: zero
 * WorkflowRun rows had ever reached SENT, max(sentAt) was NULL, and 58 runs
 * sat PENDING. Every reminder the product advertises had silently never been
 * delivered -- the queue filled up and nothing drained it.
 *
 * An external scheduler is still the better architecture, and the HTTP
 * endpoint stays exactly as it was so one can be pointed at it later. But a
 * schedule that lives outside the deployment is a schedule that can be
 * forgotten, and this one was. Running the timer in the container means
 * shipping the app ships the thing that drains the queue.
 *
 * SAFE WITH MORE THAN ONE TASK. The service runs a single task today, but
 * correctness does not depend on that: processDueWorkflowRuns claims each row
 * with a conditional UPDATE before doing any work, so overlapping runners --
 * two tasks, or a slow tick overlapping the next -- cannot both send.
 */

export async function register() {
  // Next calls register() in the edge runtime too, where timers and the
  // database client do not belong.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (process.env.WORKFLOW_CRON_DISABLED === "1") {
    console.log("[cron] in-process workflow runner disabled by WORKFLOW_CRON_DISABLED=1");
    return;
  }

  const intervalMs = Number(process.env.WORKFLOW_CRON_INTERVAL_MS || 5 * 60_000);
  if (!Number.isFinite(intervalMs) || intervalMs < 30_000) {
    console.error(`[cron] refusing to start: WORKFLOW_CRON_INTERVAL_MS=${process.env.WORKFLOW_CRON_INTERVAL_MS} is not a sane interval`);
    return;
  }

  const { processDueWorkflowRuns } = await import("./lib/workflows");

  let running = false;
  const tick = async () => {
    // A tick that overruns its interval must not stack up behind itself.
    // The database claim would stop a double SEND, but not the pile-up.
    if (running) return;
    running = true;
    try {
      const result = await processDueWorkflowRuns();
      if (result.processed > 0) {
        console.log(`[cron] processed=${result.processed} sent=${result.sent} failed=${result.failed}`);
      }
    } catch (e) {
      // Never let a bad tick kill the server. A workflow that throws is a
      // workflow that does not send; a crashed process is a site that is down.
      console.error("[cron] tick failed", e instanceof Error ? e.message : e);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, intervalMs);
  // Do not hold the process open at shutdown for the sake of a reminder.
  timer.unref?.();

  console.log(`[cron] in-process workflow runner started, every ${Math.round(intervalMs / 1000)}s`);

  // A first pass shortly after boot, not immediately: let the server finish
  // coming up and start serving before it does database work.
  setTimeout(tick, 30_000).unref?.();
}
