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
import { listOAuthAccounts } from "@agent-native/core/oauth-tokens";
import { getClientForAccount, startWatch } from "../lib/google-auth.js";
import { registerEvent } from "@agent-native/core/event-bus";
import { z } from "zod";

const INTERVAL_MS = 60_000; // 1 minute
const WATCH_RENEW_INTERVAL_MS = 12 * 60 * 60_000;
let lastWatchRenewalAt = 0;

async function renewAllWatches(): Promise<void> {
  if (!process.env.GMAIL_WATCH_TOPIC) return;
  const accounts = await listOAuthAccounts("google");
  for (const acc of accounts) {
    try {
      // Use accountId-based lookup so secondary/added accounts (where
      // `owner !== accountId`) also get their watch renewed. Gmail watches
      // expire in ~7 days and must be renewed regularly.
      const client = await getClientForAccount(acc.accountId);
      if (!client) continue;
      await startWatch(client.accessToken);
    } catch (err: any) {
      console.warn(
        `[gmail-watch] renew failed for ${acc.accountId}: ${err.message}`,
      );
    }
  }
}

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
  // ── Register mail events (runs in all modes, not just background jobs) ──
  registerEvent({
    name: "mail.message.received",
    description:
      "A new email was received in the user's inbox. Fires once per message during the polling sync cycle.",
    payloadSchema: z.object({
      messageId: z.string(),
      from: z.string(),
      to: z.string(),
      subject: z.string(),
      snippet: z.string().optional(),
      labels: z.array(z.string()).optional(),
      threadId: z.string().optional(),
    }) as any,
  });

  registerEvent({
    name: "mail.message.sent",
    description:
      "An email was sent from the user's account (via compose UI or agent action).",
    payloadSchema: z.object({
      messageId: z.string(),
      to: z.string(),
      subject: z.string(),
    }) as any,
  });

  // Background cron must only run in one place — otherwise every dev server
  // processes jobs and automations for every connected user globally, leading
  // to duplicate actions and duplicate Anthropic spend.
  if (process.env.RUN_BACKGROUND_JOBS !== "1") {
    console.log(
      "[mail-jobs] Skipping background cron (set RUN_BACKGROUND_JOBS=1 to enable)",
    );
    return;
  }

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
    if (Date.now() - lastWatchRenewalAt > WATCH_RENEW_INTERVAL_MS) {
      lastWatchRenewalAt = Date.now();
      try {
        await renewAllWatches();
      } catch (err) {
        console.error("[mail-jobs] renewAllWatches failed:", err);
      }
    }
  }, INTERVAL_MS);
};
