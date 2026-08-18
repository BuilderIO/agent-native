import { registerEvent } from "@agent-native/core/event-bus";
import { listOAuthAccounts } from "@agent-native/core/oauth-tokens";
import { startIntervalJob } from "@agent-native/core/server/interval-job";
import { z } from "zod";

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

const INTERVAL_MS = 60_000; // 1 minute
const WATCH_RENEW_INTERVAL_MS = 12 * 60 * 60_000;
// Backstop for the whole tick (job sends + Gmail watch renewal, both outbound
// network calls with no timeout of their own), reported through the job's
// onError so a wedged tick is loud rather than silent.
const TICK_ABORT_MS = Math.max(10_000, INTERVAL_MS * 4);
let lastWatchRenewalAt = 0;
// Vite's dev server initializes Nitro plugins more than once during boot
// (initial load + post-init). Module-scope flag ensures the "skipping" log
// fires at most once per process.
let skippingLogged = false;

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

  // Background cron defaults on in production and off in dev. The dev gate
  // exists because every connected dev server would otherwise process jobs
  // and automations for every user globally, causing duplicate actions and
  // duplicate Anthropic spend. Set RUN_BACKGROUND_JOBS=1 to opt in locally,
  // or RUN_BACKGROUND_JOBS=0 to opt out in production.
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

  // The overlap guard and the hung-tick timeout both come from
  // startIntervalJob rather than a module-level `running` flag here: these
  // are outbound Google calls with no timeout of their own, and releasing the
  // guard on the timeout while a hung call kept running is what let a tick
  // overlap the next one and send duplicate mail.
  startIntervalJob(
    async () => {
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
