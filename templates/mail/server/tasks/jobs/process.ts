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
  const due = db
    .select()
    .from(schema.scheduledJobs)
    .where(
      and(
        eq(schema.scheduledJobs.status, "pending"),
        lte(schema.scheduledJobs.runAt, now),
      ),
    )
    .all();

  for (const job of due) {
    // Mark as processing immediately (synchronous SQLite — no race risk in single process)
    db.update(schema.scheduledJobs)
      .set({ status: "processing" } as any)
      .where(eq(schema.scheduledJobs.id, job.id))
      .run();

    try {
      if (job.type === "snooze" && job.emailId) {
        await resurfaceEmail(job.emailId);
      } else if (job.type === "send_later") {
        await sendScheduledEmail(JSON.parse(job.payload) as SendLaterPayload);
      }
      db.update(schema.scheduledJobs)
        .set({ status: "done" } as any)
        .where(eq(schema.scheduledJobs.id, job.id))
        .run();
    } catch (err) {
      console.error(`[jobs:process] Job ${job.id} failed:`, err);
      db.update(schema.scheduledJobs)
        .set({ status: "pending" } as any)
        .where(eq(schema.scheduledJobs.id, job.id))
        .run();
    }
  }

  return { result: `Processed ${due.length} jobs` };
}
