import { and, eq, lte } from "drizzle-orm";
import { db, schema } from "../../db/index.js";
import {
  resurfaceEmail,
  sendScheduledEmail,
  type SendLaterPayload,
} from "../../lib/jobs.js";

/**
 * Process due scheduled jobs (snooze and send-later).
 * Called every 60 seconds from server/index.ts via setInterval.
 */
export async function processJobs(): Promise<{ result: string }> {
  const now = Date.now();

  // Fetch all pending due jobs
  const due = await db
    .select()
    .from(schema.scheduledJobs)
    .where(
      and(
        eq(schema.scheduledJobs.status, "pending"),
        lte(schema.scheduledJobs.runAt, now),
      ),
    );

  for (const job of due) {
    // Mark as processing immediately
    await db
      .update(schema.scheduledJobs)
      .set({ status: "processing" } as any)
      .where(eq(schema.scheduledJobs.id, job.id));

    try {
      const acctEmail = job.accountEmail ?? undefined;
      if (job.type === "snooze" && job.emailId) {
        await resurfaceEmail(job.emailId, acctEmail);
      } else if (job.type === "send_later") {
        await sendScheduledEmail(
          JSON.parse(job.payload) as SendLaterPayload,
          acctEmail,
        );
      }
      await db
        .update(schema.scheduledJobs)
        .set({ status: "done" } as any)
        .where(eq(schema.scheduledJobs.id, job.id));
    } catch (err) {
      console.error(`[jobs:process] Job ${job.id} failed:`, err);
      await db
        .update(schema.scheduledJobs)
        .set({ status: "cancelled" } as any)
        .where(eq(schema.scheduledJobs.id, job.id));
    }
  }

  return { result: `Processed ${due.length} jobs` };
}
