import {
  getDuePendingJobs,
  getSnoozeThreadId,
  markJobCancelled,
  markJobDone,
  markJobProcessing,
  resurfaceEmail,
  sendScheduledEmail,
  shouldResurfaceSnoozedThread,
  type SendLaterPayload,
} from "../lib/jobs.js";
import { processAutomations } from "../lib/automation-engine.js";

const INTERVAL_MS = 60_000; // 1 minute

async function processJobs(): Promise<void> {
  const now = Date.now();
  const due = await getDuePendingJobs(now);

  for (const job of due) {
    await markJobProcessing(job.id);

    try {
      const ownerEmail = job.ownerEmail || job.accountEmail;
      const acctEmail = job.accountEmail ?? undefined;
      if (job.type === "snooze" && job.emailId) {
        const shouldResurface = await shouldResurfaceSnoozedThread(job);
        if (shouldResurface && ownerEmail) {
          await resurfaceEmail(
            ownerEmail,
            job.emailId,
            getSnoozeThreadId(job),
            acctEmail,
          );
        }
      } else if (job.type === "send_later") {
        await sendScheduledEmail(
          JSON.parse(job.payload) as SendLaterPayload,
          acctEmail,
          ownerEmail || undefined,
        );
      }
      await markJobDone(job.id);
    } catch (err) {
      console.error(`[mail-jobs] Job ${job.id} failed:`, err);
      await markJobCancelled(job.id);
    }
  }
}

export default () => {
  setInterval(async () => {
    try {
      await processJobs();
    } catch (err) {
      console.error("[mail-jobs] processJobs failed:", err);
    }
    try {
      await processAutomations();
    } catch (err) {
      console.error("[mail-jobs] processAutomations failed:", err);
    }
  }, INTERVAL_MS);
};
