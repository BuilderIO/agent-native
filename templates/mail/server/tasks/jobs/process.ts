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
} from "../../lib/jobs.js";

/**
 * Process due scheduled jobs (snooze and send-later).
 * Called every 60 seconds from server/index.ts via setInterval.
 */
export async function processJobs(): Promise<{ result: string }> {
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
        );
      }
      await markJobDone(job.id);
    } catch (err) {
      console.error(`[jobs:process] Job ${job.id} failed:`, err);
      await markJobCancelled(job.id);
    }
  }

  return { result: `Processed ${due.length} jobs` };
}
