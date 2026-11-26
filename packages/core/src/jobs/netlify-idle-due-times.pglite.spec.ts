import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { nextAgentHarnessRecoveryDueAt } from "../agent/harness/store.js";
import { resolveBackgroundRunHardTimeoutMs } from "../agent/run-manager.js";
import { nextQueuedSubmissionDueAt } from "../chat-threads/store.js";
import { closeDbExec, getDbExec } from "../db/client.js";
import {
  nextStaleAgentTeamRunDueAt,
  RUN_DISPATCH_STUCK_AFTER_MS,
  RUN_RECONCILIATION_RETRY_AFTER_MS,
} from "../server/agent-teams-run-queue.js";
import { nextAutomationTriggerEventDueAt } from "../triggers/event-queue.js";
import { nextAutomationFailureAlertDueAt } from "./run-history.js";
import {
  nextStaleWorkDueAt,
  resetStaleWorkReapThrottle,
  STALE_A2A_TASK_AFTER_MS,
  STALE_AUTOMATION_RUN_AFTER_MS,
} from "./stale-reaper.js";

let previousDatabaseUrl: string | undefined;

beforeAll(async () => {
  previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "pglite:memory";
  await closeDbExec();
});

afterAll(async () => {
  await closeDbExec();
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
});

describe("due times an idle Netlify app sleeps until", () => {
  it("answers the earliest queued submission retry, or now for one with none", async () => {
    await expect(nextQueuedSubmissionDueAt()).resolves.toBeNull();
    const queue = (
      messageId: string,
      state: string,
      retryAfter: number | null,
    ) =>
      getDbExec().execute({
        sql: `INSERT INTO agent_chat_submission_inbox
              (thread_id, message_id, state, actor_email, payload_hash, payload_json, retry_after, created_at, updated_at)
              VALUES ('thread-1', ?, ?, 'owner@example.com', 'hash', '{}', ?, 1, 1)`,
        args: [messageId, state, retryAfter],
      });

    await queue("submitted", "submitted", null);
    await queue("later", "queued", 90_000);
    await queue("sooner", "queued", 40_000);
    await expect(nextQueuedSubmissionDueAt()).resolves.toBe(40_000);

    await queue("now", "queued", null);
    await expect(nextQueuedSubmissionDueAt()).resolves.toBe(0);
  });

  it("answers the earliest failure alert retry, lapsed claim, or alert to evaluate", async () => {
    await expect(nextAutomationFailureAlertDueAt()).resolves.toBeNull();
    const run = (
      id: string,
      state: string,
      fields: {
        email?: string | null;
        nextAttemptAt?: number | null;
        claimedAt?: number | null;
      },
    ) =>
      getDbExec().execute({
        sql: `INSERT INTO automation_runs
              (id, owner, automation, path, status, started_at, notification_email,
               failure_alert_state, failure_alert_next_attempt_at, failure_alert_claimed_at)
              VALUES (?, 'owner@example.com', 'digest', 'jobs/digest.md', 'error', 1, ?, ?, ?, ?)`,
        args: [
          id,
          fields.email === undefined ? "owner@example.com" : fields.email,
          state,
          fields.nextAttemptAt ?? null,
          fields.claimedAt ?? null,
        ],
      });

    await run("delivered", "delivered", { nextAttemptAt: 1_000 });
    await run("no-recipient", "pending", { email: null, nextAttemptAt: 2_000 });
    await run("retry", "pending", { nextAttemptAt: 80_000 });
    await run("claimed", "sending", { claimedAt: 10_000 });
    await expect(nextAutomationFailureAlertDueAt()).resolves.toBe(70_000);

    await run("new", "evaluating", {});
    await expect(nextAutomationFailureAlertDueAt()).resolves.toBe(0);
  });

  it("answers the earliest claimable trigger event, not events waiting behind it", async () => {
    await expect(nextAutomationTriggerEventDueAt("mail")).resolves.toBeNull();
    const event = (
      id: string,
      triggerId: string,
      status: string,
      availableAt: number,
      fields: { claimedAt?: number; appId?: string } = {},
    ) =>
      getDbExec().execute({
        sql: `INSERT INTO automation_trigger_event_queue
              (id, trigger_id, trigger_owner, trigger_path, app_id, event_name,
               event_id, payload, emitted_at, status, available_at, claimed_at,
               created_at)
              VALUES (?, ?, 'owner@example.com', 'jobs/on-mail.md', ?,
                      'mail.received', ?, '{}', '2026-11-20T12:00:00.000Z',
                      ?, ?, ?, 1)`,
        args: [
          id,
          triggerId,
          fields.appId ?? "mail",
          id,
          status,
          availableAt,
          fields.claimedAt ?? null,
        ],
      });

    await event("done", "trigger-a", "completed", 1);
    await event("head", "trigger-a", "pending", 9_000_000_000);
    await event("behind", "trigger-a", "pending", 1_000);
    await event("other-app", "trigger-c", "pending", 2_000, {
      appId: "calendar",
    });
    await expect(nextAutomationTriggerEventDueAt("mail")).resolves.toBe(
      9_000_000_000,
    );

    await event("lapsed", "trigger-b", "processing", 1, { claimedAt: 5_000 });
    await expect(nextAutomationTriggerEventDueAt("mail")).resolves.toBe(
      5_000 + Math.ceil(resolveBackgroundRunHardTimeoutMs() * 1.5),
    );
  });

  it("answers when the next in-flight automation run or A2A task can be reaped", async () => {
    resetStaleWorkReapThrottle();
    await expect(nextStaleWorkDueAt()).resolves.toBeNull();

    await getDbExec().execute({
      sql: `INSERT INTO automation_runs
            (id, owner, automation, path, status, started_at)
            VALUES ('stuck', 'owner@example.com', 'digest', 'jobs/digest.md', 'running', 5000)`,
      args: [],
    });
    await expect(nextStaleWorkDueAt()).resolves.toBe(
      5_000 + STALE_AUTOMATION_RUN_AFTER_MS,
    );

    const task = (id: string, state: string, updatedAt: number) =>
      getDbExec().execute({
        sql: `INSERT INTO a2a_tasks
              (id, status_state, status_timestamp, created_at, updated_at)
              VALUES (?, ?, '2026-11-20T12:00:00.000Z', 1000, ?)`,
        args: [id, state, updatedAt],
      });
    await task("finished", "completed", 1_000);
    await task("working", "working", 3_000);
    await expect(nextStaleWorkDueAt()).resolves.toBe(
      3_000 + STALE_A2A_TASK_AFTER_MS,
    );
  });

  it("answers when the next Agent Harness follow-up or approval claim can be recovered", async () => {
    await expect(nextAgentHarnessRecoveryDueAt()).resolves.toBeNull();
    const session = (
      id: string,
      status: string,
      fields: {
        followUpClaimId?: string;
        followUpClaimExpiresAt?: number;
        followUpDeadlineAt?: number;
        approvalResolutionId?: string;
        approvalClaimExpiresAt?: number;
      },
    ) =>
      getDbExec().execute({
        sql: `INSERT INTO agent_harness_sessions
              (id, harness_name, thread_id, status, created_at, updated_at,
               follow_up_claim_id, follow_up_claim_expires_at,
               follow_up_deadline_at, approval_resolution_id,
               approval_resolution_claim_expires_at)
              VALUES (?, 'codex', 'thread-1', ?, 1000, 1000, ?, ?, ?, ?, ?)`,
        args: [
          id,
          status,
          fields.followUpClaimId ?? null,
          fields.followUpClaimExpiresAt ?? null,
          fields.followUpDeadlineAt ?? null,
          fields.approvalResolutionId ?? null,
          fields.approvalClaimExpiresAt ?? null,
        ],
      });

    await session("unclaimed", "running", {});
    await session("stopped", "stopped", {
      approvalResolutionId: "approval-0",
      approvalClaimExpiresAt: 2_000,
    });
    await session("follow-up", "running", {
      followUpClaimId: "claim-1",
      followUpClaimExpiresAt: 90_000,
      followUpDeadlineAt: 50_000,
    });
    await session("approval", "idle", {
      approvalResolutionId: "approval-1",
      approvalClaimExpiresAt: 70_000,
    });
    await expect(nextAgentHarnessRecoveryDueAt()).resolves.toBe(50_000);

    await session("follow-up-behind-approval", "running", {
      followUpClaimId: "claim-2",
      followUpClaimExpiresAt: 10_000,
      approvalResolutionId: "approval-2",
      approvalClaimExpiresAt: 30_000,
    });
    await expect(nextAgentHarnessRecoveryDueAt()).resolves.toBe(30_000);
  });

  it("answers when the next active Agent Teams run can be reconciled", async () => {
    await expect(nextStaleAgentTeamRunDueAt()).resolves.toBeNull();
    const run = (
      taskId: string,
      status: string,
      updatedAt: number,
      reconciliationAttemptedAt: number | null,
      ownerEmail: string | null = "owner@example.com",
    ) =>
      getDbExec().execute({
        sql: `INSERT INTO agent_team_run_queue
              (task_id, thread_id, run_id, status, owner_email, payload,
               created_at, updated_at, reconciliation_attempted_at)
              VALUES (?, 'thread-1', ?, ?, ?, '{}', 1, ?, ?)`,
        args: [
          taskId,
          `run-${taskId}`,
          status,
          ownerEmail,
          updatedAt,
          reconciliationAttemptedAt,
        ],
      });

    await run("done", "done", 1_000, null);
    await run("ownerless", "queued", 1_000, null, null);
    await run("attempted", "running", 2_000, 50_000);
    await run("queued", "queued", 80_000, null);
    await expect(nextStaleAgentTeamRunDueAt()).resolves.toBe(
      Math.min(
        50_000 + RUN_RECONCILIATION_RETRY_AFTER_MS,
        80_000 + RUN_DISPATCH_STUCK_AFTER_MS,
      ),
    );
  });
});
