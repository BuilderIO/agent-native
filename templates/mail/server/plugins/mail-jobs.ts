import {
  getDbExec,
  isProductionServerlessFunctionRuntime,
} from "@agent-native/core/db";
import { registerEvent } from "@agent-native/core/event-bus";
import { getOAuthTokens } from "@agent-native/core/oauth-tokens";
import {
  isInBackgroundFunctionRuntime,
  registerRecurringSweepHandler,
  startIntervalJob,
  type RecurringSweepContext,
} from "@agent-native/core/server";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../db/index.js";
import {
  processMailAiFilterBackfills,
  purgeExpiredMailAiFilterBackfills,
} from "../lib/ai-filter-backfill.js";
import { purgeExpiredMailAiFilterRuleUndoSnapshots } from "../lib/ai-filter-rule-undo.js";
import { processAutomationsForAccount } from "../lib/automation-engine.js";
import { getClientFromAccount, startWatch } from "../lib/google-auth.js";
import { ensureSyncAccountRow } from "../lib/inbox-store.js";
import {
  getDuePendingJobs,
  getSnoozeThreadId,
  markJobCancelled,
  markJobDone,
  markJobProcessing,
  markJobSendStarted,
  markJobUncertain,
  markExpiredScheduledSendsUncertain,
  resurfaceEmail,
  releaseJobProcessing,
  resetJobProcessingForRetry,
  sendScheduledEmail,
  shouldResurfaceSnoozedThread,
  type SendLaterPayload,
} from "../lib/jobs.js";

const INTERVAL_MS = 60_000;
const AI_FILTER_BACKFILL_INTERVAL_MS = 10_000;
const WATCH_RENEW_INTERVAL_MS = 6 * 60 * 60_000;
const WATCH_RENEW_CLAIM_MS = 10 * 60_000;
const JOB_PROCESSING_LEASE_GRACE_MS = 30_000;
const MAX_DUE_JOBS_PER_TICK = 20;
const MAX_AUTOMATION_ACCOUNTS_PER_TICK = 5;
const MAX_WATCH_ACCOUNTS_PER_TICK = 5;
const TICK_ABORT_MS = Math.max(10_000, INTERVAL_MS * 4);
let skippingLogged = false;

type WatchRenewalClaim = { accountRowId: string; claimId: string };
function isDeadlineReached(context: RecurringSweepContext): boolean {
  return context.signal?.aborted || Date.now() >= context.deadlineAt;
}

function incompleteSweepError(message: string): Error {
  return new Error(`Mail background sweep incomplete: ${message}`);
}

function makeAggregateError(errors: Iterable<unknown>, message: string): Error {
  const NativeAggregateError = (
    globalThis as unknown as {
      AggregateError: new (errors: Iterable<unknown>, message: string) => Error;
    }
  ).AggregateError;
  return new NativeAggregateError(errors, message);
}

async function oldestMailAccountCandidates(
  attemptColumn:
    | typeof schema.mailSyncAccounts.lastAutomationAttemptedAt
    | typeof schema.mailSyncAccounts.lastWatchAttemptedAt,
  limit: number,
) {
  const attemptColumnName =
    attemptColumn === schema.mailSyncAccounts.lastAutomationAttemptedAt
      ? "last_automation_attempted_at"
      : "last_watch_attempted_at";
  const { rows } = await getDbExec().execute({
    sql: `SELECT mail_sync_accounts.id AS sync_account_id,
                 COALESCE(mail_sync_accounts.owner_email, oauth_tokens.owner, oauth_tokens.account_id) AS owner_email,
                 oauth_tokens.account_id,
                 oauth_tokens.owner AS oauth_owner
          FROM public.oauth_tokens AS oauth_tokens
          LEFT JOIN mail_sync_accounts
            ON LOWER(mail_sync_accounts.owner_email) = LOWER(COALESCE(oauth_tokens.owner, oauth_tokens.account_id))
            AND LOWER(mail_sync_accounts.account_email) = LOWER(oauth_tokens.account_id)
          WHERE oauth_tokens.provider = ?
            AND COALESCE(mail_sync_accounts.status, 'idle') <> 'needs_reauth'
          ORDER BY COALESCE(mail_sync_accounts.${attemptColumnName}, 0),
                   LOWER(COALESCE(oauth_tokens.owner, oauth_tokens.account_id)),
                   LOWER(oauth_tokens.account_id)
          LIMIT ?`,
    args: ["google", limit],
  });
  return rows.map((row) => ({
    id: (row.sync_account_id as string | null) ?? null,
    ownerEmail: row.owner_email as string,
    accountEmail: row.account_id as string,
    oauthOwner: (row.oauth_owner as string | null) ?? null,
  }));
}

async function markAccountAttempted(
  accountId: string,
  kind: "automation" | "watch",
): Promise<void> {
  const now = Date.now();
  const attempt =
    kind === "automation"
      ? { lastAutomationAttemptedAt: now }
      : { lastWatchAttemptedAt: now };
  const rows = await getDb()
    .update(schema.mailSyncAccounts)
    .set({ ...attempt, updatedAt: now })
    .where(eq(schema.mailSyncAccounts.id, accountId))
    .returning({ id: schema.mailSyncAccounts.id });
  if (rows.length === 0) {
    throw new Error(`Mail account attempt cursor is missing for ${accountId}.`);
  }
}

async function claimWatchRenewal(
  accountRowId: string,
): Promise<WatchRenewalClaim | null> {
  const now = Date.now();
  const claimId = nanoid(24);
  const rows = await getDb()
    .update(schema.mailSyncAccounts)
    .set({
      watchRenewClaimId: claimId,
      watchRenewClaimedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.mailSyncAccounts.id, accountRowId),
        or(
          isNull(schema.mailSyncAccounts.lastWatchRenewedAt),
          lte(
            schema.mailSyncAccounts.lastWatchRenewedAt,
            now - WATCH_RENEW_INTERVAL_MS,
          ),
        ),
        or(
          isNull(schema.mailSyncAccounts.watchRenewClaimId),
          isNull(schema.mailSyncAccounts.watchRenewClaimedAt),
          lte(
            schema.mailSyncAccounts.watchRenewClaimedAt,
            now - WATCH_RENEW_CLAIM_MS,
          ),
        ),
      ),
    )
    .returning({ id: schema.mailSyncAccounts.id });
  return rows.length > 0 ? { accountRowId, claimId } : null;
}

async function completeWatchRenewal(
  accountId: string,
  claim: WatchRenewalClaim,
): Promise<void> {
  const renewedAt = Date.now();
  const rows = await getDb()
    .update(schema.mailSyncAccounts)
    .set({
      lastWatchRenewedAt: renewedAt,
      watchRenewClaimId: null,
      watchRenewClaimedAt: null,
      updatedAt: renewedAt,
    })
    .where(
      and(
        eq(schema.mailSyncAccounts.id, claim.accountRowId),
        eq(schema.mailSyncAccounts.watchRenewClaimId, claim.claimId),
      ),
    )
    .returning({ id: schema.mailSyncAccounts.id });
  if (rows.length === 0) {
    throw new Error(`Gmail watch renewal claim was lost for ${accountId}.`);
  }
}

async function releaseWatchRenewal(claim: WatchRenewalClaim): Promise<void> {
  const now = Date.now();
  await getDb()
    .update(schema.mailSyncAccounts)
    .set({
      watchRenewClaimId: null,
      watchRenewClaimedAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.mailSyncAccounts.id, claim.accountRowId),
        eq(schema.mailSyncAccounts.watchRenewClaimId, claim.claimId),
      ),
    );
}

async function renewAllWatches(context: RecurringSweepContext): Promise<void> {
  if (!process.env.GMAIL_WATCH_TOPIC) return;
  const accounts = await oldestMailAccountCandidates(
    schema.mailSyncAccounts.lastWatchAttemptedAt,
    MAX_WATCH_ACCOUNTS_PER_TICK,
  );
  const failures: unknown[] = [];
  for (const acc of accounts) {
    if (isDeadlineReached(context)) {
      throw incompleteSweepError("Gmail watch renewals remain pending.");
    }
    const ownerEmail = acc.ownerEmail.trim().toLowerCase();
    let claim: WatchRenewalClaim | null = null;
    try {
      const accountRowId =
        acc.id ?? (await ensureSyncAccountRow(ownerEmail, acc.accountEmail)).id;
      await markAccountAttempted(accountRowId, "watch");
      if (isDeadlineReached(context)) {
        throw incompleteSweepError(
          `Gmail watch renewal remains pending for ${acc.accountEmail}.`,
        );
      }
      const tokens = await getOAuthTokens(
        "google",
        acc.accountEmail,
        acc.oauthOwner ?? undefined,
      );
      if (isDeadlineReached(context)) {
        throw incompleteSweepError(
          `Gmail watch renewal remains pending for ${acc.accountEmail}.`,
        );
      }
      if (!tokens) continue;
      claim = await claimWatchRenewal(accountRowId);
      if (!claim) continue;
      const client = await getClientFromAccount({
        accountId: acc.accountEmail,
        owner: acc.oauthOwner ?? ownerEmail,
        tokens,
      });
      if (!client) throw new Error("No usable Google account token.");
      if (!(await startWatch(client.accessToken, context.signal))) {
        throw new Error("Gmail did not start the watch.");
      }
      await completeWatchRenewal(acc.accountEmail, claim);
      if (isDeadlineReached(context)) {
        throw incompleteSweepError(
          `Gmail watch renewal completed for ${acc.accountEmail} as the sweep deadline elapsed.`,
        );
      }
    } catch (error) {
      if (claim) {
        try {
          await releaseWatchRenewal(claim);
        } catch (releaseError) {
          const failure = makeAggregateError(
            [error, releaseError],
            `Gmail watch renewal and claim release failed for ${acc.accountEmail}.`,
          );
          failures.push(failure);
          console.warn(
            `[gmail-watch] renew and claim release failed for ${acc.accountEmail}:`,
            error,
            releaseError,
          );
          if (context.signal?.aborted) throw failure;
          continue;
        }
      }
      if (context.signal?.aborted) context.signal.throwIfAborted();
      if (error instanceof Error && error.name === "AbortError") throw error;
      failures.push(error);
      console.warn(
        `[gmail-watch] renew failed for ${acc.accountEmail}:`,
        error,
      );
    }
  }
  if (failures.length > 0) {
    throw makeAggregateError(
      failures,
      `Gmail watch renewal failed for ${failures.length} account(s).`,
    );
  }
}

async function processJobs(context: RecurringSweepContext): Promise<void> {
  const now = Date.now();
  const expiredSends = await markExpiredScheduledSendsUncertain(now);
  if (expiredSends > 0) {
    console.warn(
      `[mail-jobs] Marked ${expiredSends} scheduled send(s) with expired dispatch leases as uncertain.`,
    );
  }
  const due = await getDuePendingJobs(now, MAX_DUE_JOBS_PER_TICK);
  if (isDeadlineReached(context)) {
    throw incompleteSweepError("scheduled Mail jobs remain pending.");
  }

  for (const job of due) {
    if (isDeadlineReached(context)) {
      throw incompleteSweepError("scheduled Mail jobs remain pending.");
    }
    const claimId = await markJobProcessing(
      job.id,
      Date.now(),
      context.deadlineAt + JOB_PROCESSING_LEASE_GRACE_MS,
    );
    if (!claimId) continue;
    let sendStarted = false;

    try {
      if (isDeadlineReached(context)) {
        await releaseJobProcessing(job.id, claimId);
        throw incompleteSweepError(
          `scheduled Mail job ${job.id} remains pending.`,
        );
      }
      const ownerEmail = job.ownerEmail || job.accountEmail;
      const acctEmail = job.accountEmail ?? undefined;
      if (job.type === "snooze" && job.emailId) {
        const shouldResurface = await shouldResurfaceSnoozedThread(
          job,
          context.signal,
        );
        if (isDeadlineReached(context)) {
          throw incompleteSweepError(
            `scheduled Mail job ${job.id} remains pending.`,
          );
        }
        if (shouldResurface && ownerEmail) {
          await resurfaceEmail(
            ownerEmail,
            job.emailId,
            getSnoozeThreadId(job),
            acctEmail,
            context.signal,
          );
        }
      } else if (job.type === "send_later") {
        await sendScheduledEmail(
          JSON.parse(job.payload) as SendLaterPayload,
          acctEmail,
          job.ownerEmail ?? undefined,
          {
            signal: context.signal,
            onDispatchStart: async () => {
              if (isDeadlineReached(context)) {
                throw incompleteSweepError(
                  `scheduled email ${job.id} remains pending.`,
                );
              }
              if (!(await markJobSendStarted(job.id, claimId))) {
                throw new Error(
                  `Scheduled email claim was lost before sending ${job.id}.`,
                );
              }
              sendStarted = true;
              if (isDeadlineReached(context)) {
                if (await resetJobProcessingForRetry(job.id, claimId)) {
                  sendStarted = false;
                }
                if (context.signal?.aborted) context.signal.throwIfAborted();
                throw incompleteSweepError(
                  `scheduled email ${job.id} remains pending.`,
                );
              }
            },
            onDispatchCancelled: async () => {
              if (await resetJobProcessingForRetry(job.id, claimId)) {
                sendStarted = false;
              }
            },
          },
        );
      }
      if (!(await markJobDone(job.id, claimId))) {
        console.warn(
          `[mail-jobs] Job ${job.id} completed after its claim was lost.`,
        );
      }
    } catch (error) {
      if (
        isDeadlineReached(context) ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        if (sendStarted) {
          await markJobUncertain(job.id, claimId);
        } else {
          try {
            await releaseJobProcessing(job.id, claimId);
          } catch (releaseError) {
            throw makeAggregateError(
              [error, releaseError],
              `Mail job ${job.id} was cancelled and its claim could not be released.`,
            );
          }
        }
        if (context.signal?.aborted) {
          if (error instanceof Error && error.name === "AggregateError") {
            throw error;
          }
          context.signal.throwIfAborted();
        }
        throw error;
      }
      console.error(`[mail-jobs] Job ${job.id} failed:`, error);
      if (!sendStarted) {
        await markJobCancelled(job.id, claimId);
      } else {
        await markJobUncertain(job.id, claimId);
        console.error(
          `[mail-jobs] Scheduled send ${job.id} has an uncertain provider result and will not be retried automatically.`,
        );
      }
    }
  }
}

async function processAutomations(
  context: RecurringSweepContext,
): Promise<void> {
  const accounts = await oldestMailAccountCandidates(
    schema.mailSyncAccounts.lastAutomationAttemptedAt,
    MAX_AUTOMATION_ACCOUNTS_PER_TICK,
  );
  const failures: unknown[] = [];

  for (const account of accounts) {
    if (isDeadlineReached(context)) {
      throw incompleteSweepError("Mail automations remain pending.");
    }
    const ownerEmail = account.ownerEmail.trim().toLowerCase();
    try {
      const accountRowId =
        account.id ??
        (await ensureSyncAccountRow(ownerEmail, account.accountEmail)).id;
      await markAccountAttempted(accountRowId, "automation");
      if (isDeadlineReached(context)) {
        throw incompleteSweepError(
          `Mail automation remains pending for ${account.accountEmail}.`,
        );
      }
      const tokens = await getOAuthTokens(
        "google",
        account.accountEmail,
        account.oauthOwner ?? undefined,
      );
      if (isDeadlineReached(context)) {
        throw incompleteSweepError(
          `Mail automation remains pending for ${account.accountEmail}.`,
        );
      }
      if (!tokens) continue;
      const client = await getClientFromAccount({
        accountId: account.accountEmail,
        owner: account.oauthOwner ?? ownerEmail,
        tokens,
      });
      if (!client) continue;
      if (isDeadlineReached(context)) {
        throw incompleteSweepError(
          `Mail automation remains pending for ${account.accountEmail}.`,
        );
      }
      await processAutomationsForAccount(
        ownerEmail,
        account.accountEmail,
        client.accessToken,
        context.signal,
      );
    } catch (error) {
      if (context.signal?.aborted) context.signal.throwIfAborted();
      if (error instanceof Error && error.name === "AbortError") throw error;
      failures.push(error);
      console.error(
        `[mail-jobs] automation processing failed for ${account.accountEmail}:`,
        error,
      );
    }
  }

  if (failures.length > 0) {
    throw makeAggregateError(
      failures,
      `Mail automation processing failed for ${failures.length} account(s).`,
    );
  }
}

async function processMailBackgroundJobs(
  context: RecurringSweepContext = { deadlineAt: Date.now() + TICK_ABORT_MS },
): Promise<void> {
  const failures: unknown[] = [];
  const runStep = async (name: string, run: () => Promise<unknown>) => {
    if (isDeadlineReached(context)) {
      const error = incompleteSweepError(
        `${name} did not start before the deadline.`,
      );
      failures.push(error);
      console.error(`[mail-jobs] ${name} skipped:`, error);
      return;
    }
    try {
      await run();
    } catch (error) {
      failures.push(error);
      console.error(`[mail-jobs] ${name} failed:`, error);
    }
  };

  await runStep("processJobs", () => processJobs(context));
  await runStep("processAutomations", () => processAutomations(context));
  await runStep("renewAllWatches", () => renewAllWatches(context));
  await runStep(
    "AI-filter undo cleanup",
    purgeExpiredMailAiFilterRuleUndoSnapshots,
  );
  await runStep(
    "AI-filter backfill cleanup",
    purgeExpiredMailAiFilterBackfills,
  );

  if (failures.length > 0) {
    throw makeAggregateError(
      failures,
      "One or more Mail background jobs failed.",
    );
  }
}

export default () => {
  registerRecurringSweepHandler("mail-ai-filter-backfills", async (context) => {
    if (isDeadlineReached(context)) {
      throw incompleteSweepError(
        "AI-filter backfills did not start before the deadline.",
      );
    }
    await processMailAiFilterBackfills(
      undefined,
      undefined,
      Math.min(context.deadlineAt, Date.now() + 45_000),
    );
  });

  registerEvent({
    name: "mail.message.received",
    description:
      "A new email was received in the user's inbox. Fires once per message and includes the accountEmail and messageId for exact message lookup.",
    payloadSchema: z.object({
      messageId: z.string(),
      accountEmail: z.string(),
      from: z.string(),
      to: z.string(),
      subject: z.string(),
      snippet: z.string().optional(),
      labels: z.array(z.string()).optional(),
      threadId: z.string().optional(),
    }) as any,
    example: {
      messageId: "message_123",
      accountEmail: "person@example.com",
      from: "sender@example.com",
      to: "person@example.com",
      subject: "A new message",
      snippet: "Message preview",
      labels: ["INBOX"],
      threadId: "thread_123",
    },
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
  if (enabled) {
    registerRecurringSweepHandler(
      "mail-background-jobs",
      processMailBackgroundJobs,
    );
  }
  if (!enabled) {
    if (!skippingLogged) {
      console.log(
        "[mail-jobs] Skipping background cron (set RUN_BACKGROUND_JOBS=1 to enable in dev; on by default in production)",
      );
      skippingLogged = true;
    }
    return;
  }

  if (
    isProductionServerlessFunctionRuntime() ||
    isInBackgroundFunctionRuntime()
  ) {
    return;
  }

  startIntervalJob(
    async () => {
      try {
        await processMailBackgroundJobs();
      } catch (err) {
        console.error("[mail-jobs] background job tick failed:", err);
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

  startIntervalJob(
    async () => {
      await processMailAiFilterBackfills();
    },
    {
      intervalMs: AI_FILTER_BACKFILL_INTERVAL_MS,
      timeoutMs: 45_000,
      leading: false,
      onError: (err) =>
        console.error("[mail-jobs] AI-filter backfill tick failed:", err),
    },
  );
};
