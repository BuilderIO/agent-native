import { registerEvent } from "@agent-native/core/event-bus";
import { listOAuthAccounts } from "@agent-native/core/oauth-tokens";
import { startIntervalJob } from "@agent-native/core/server/interval-job";
import { z } from "zod";

import { purgeExpiredMailAiFilterRuleUndoSnapshots } from "../lib/ai-filter-rule-undo.js";
import { processAutomations } from "../lib/automation-engine.js";
import { getClientForAccount, startWatch } from "../lib/google-auth.js";
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

const INTERVAL_MS = 60_000;
const WATCH_RENEW_INTERVAL_MS = 12 * 60 * 60_000;
const TICK_ABORT_MS = Math.max(10_000, INTERVAL_MS * 4);
let lastWatchRenewalAt = 0;
let skippingLogged = false;

async function renewAllWatches(): Promise<void> {
  if (!process.env.GMAIL_WATCH_TOPIC) return;
  const accounts = await listOAuthAccounts("google");
  for (const acc of accounts) {
    try {
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
    if (!(await markJobProcessing(job.id))) continue;

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
          job.ownerEmail ?? undefined,
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

  const isProd = process.env.NODE_ENV === "production";
  const flag = process.env.RUN_BACKGROUND_JOBS;
  const enabled = flag === "1" || (isProd && flag !== "0");
  if (!enabled) {
    if (!skippingLogged) {
      console.log(
        "[mail-jobs] Skipping background cron (set RUN_BACKGROUND_JOBS=1 to enable in dev; on by default in production)",
      );
      skippingLogged = true;
    }
    return;
  }

  startIntervalJob(
    async () => {
      try {
        await purgeExpiredMailAiFilterRuleUndoSnapshots();
      } catch (err) {
        console.error("[mail-jobs] AI-filter undo cleanup failed:", err);
      }
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
    },
    {
      intervalMs: INTERVAL_MS,
      timeoutMs: TICK_ABORT_MS,
      leading: false,
      onError: (err) =>
        console.error("[mail-jobs] tick exceeded time budget:", err),
    },
  );
};
