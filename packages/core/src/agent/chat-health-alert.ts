import { randomUUID } from "node:crypto";

import { getDbExec } from "../db/client.js";
import { notifyWithDelivery } from "../notifications/registry.js";
import { buildFailureContext } from "../observability/failure-context.js";
import { runWithRequestContext } from "../server/request-context.js";
import { deleteSettingIfValue, mutateSetting } from "../settings/store.js";

const WINDOW_MS = 60 * 60_000;
const A2A_STALE_TASK_LOOKBACK_MS = 24 * 60 * 60_000;
const MIN_TURNS = 5;
const BAD_RATE_THRESHOLD = 0.5;
const COOLDOWN_MS = 60 * 60_000;
const CLAIM_LEASE_MS = 5 * 60_000;
const SAMPLE_FAILED_RUNS = 3;

const LAST_ALERT_SETTING_KEY = "chat-health-alert:last-slack-alert-at";

export type ChatHealthAlertOutcome =
  | { status: "healthy"; turns: number; badRate: number }
  | { status: "insufficient-data"; turns: number }
  | { status: "cooldown"; retryAfterMs: number }
  | {
      status: "alerted";
      turns: number;
      badRate: number;
      staleA2ATasks: number;
      recipients: number;
    }
  | { status: "delivery-failed"; reason: string }
  | { status: "persistence-failed"; reason: string }
  | { status: "check-failed"; reason: string };

interface TurnCounts {
  turns: number;
  bad: number;
}

interface AlertRecipient {
  owner: string;
  orgId: string;
}

async function countRecentTurns(since: number): Promise<TurnCounts> {
  const { rows } = await getDbExec().execute({
    sql: `WITH ranked AS (
            SELECT turn_id, status,
                   ROW_NUMBER() OVER (
                     PARTITION BY turn_id ORDER BY started_at DESC
                   ) AS rn
            FROM agent_runs
            WHERE started_at >= ?
              AND turn_id IS NOT NULL
              AND id NOT LIKE 'job-%'
          )
          SELECT COUNT(*) AS turns,
                 SUM(CASE WHEN status = 'errored' THEN 1 ELSE 0 END) AS bad
          FROM ranked
          WHERE rn = 1 AND status <> 'aborted'`,
    args: [since],
  });
  const row = rows[0] as Record<string, unknown> | undefined;
  return {
    turns: Number(row?.turns ?? 0),
    bad: Number(row?.bad ?? 0),
  };
}

/**
 * The latest failed turns as one line each, so whoever reads the alert can open
 * a failing thread instead of asking for an example.
 */
async function sampleFailedRuns(since: number): Promise<string[]> {
  const { rows } = await getDbExec().execute({
    sql: `SELECT id, thread_id, error_code, terminal_reason
            FROM agent_runs
           WHERE started_at >= ?
             AND status = 'errored'
             AND turn_id IS NOT NULL
             AND id NOT LIKE 'job-%'
           ORDER BY started_at DESC
           LIMIT ${SAMPLE_FAILED_RUNS}`,
    args: [since],
  });
  return rows.flatMap((raw) => {
    const row = raw as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id) return [];
    const threadId =
      typeof row.thread_id === "string" && row.thread_id
        ? row.thread_id
        : undefined;
    const reason = [row.error_code, row.terminal_reason]
      .filter((part): part is string => typeof part === "string" && !!part)
      .join(" / ");
    const where = threadId
      ? (buildFailureContext({ threadId }).threadUrl ?? `thread ${threadId}`)
      : "thread unknown";
    return [`- ${where} (run ${row.id}${reason ? `, ${reason}` : ""})`];
  });
}

async function countStaleA2ATasks(now: number): Promise<number> {
  const client = getDbExec();
  const { rows: tableRows } = await client.execute({
    sql: `SELECT to_regclass('a2a_tasks') AS relation`,
    args: [],
  });
  if (!tableRows[0]) {
    throw new Error("The A2A task table check returned no row.");
  }
  if (!(tableRows[0] as Record<string, unknown>).relation) return 0;

  const { ensureTable } = await import("../a2a/task-store.js");
  await ensureTable();
  const { getA2ATaskRecoveryLimits } = await import("../a2a/handlers.js");
  const {
    queuedLifetimeMaxMs,
    processingStuckAfterMs,
    processingLifetimeMaxMs,
  } = getA2ATaskRecoveryLimits();
  // Inline handlers move to working before execution and may stream for a long time.
  const { rows } = await client.execute({
    sql: `SELECT COUNT(*)::int AS stale_tasks
          FROM a2a_tasks
          WHERE status_state IN ('submitted', 'working', 'processing')
            AND created_at > ?
            AND (
              (status_state IN ('submitted', 'working')
                AND created_at <= ?
                AND (status_state = 'submitted' OR
                  strpos(COALESCE(metadata, ''), '"__a2a_processor"') > 0))
              OR
              (status_state = 'processing' AND
                strpos(COALESCE(metadata, ''), '"__a2a_processor"') > 0 AND
                (updated_at <= ? OR created_at <= ?))
            )`,
    args: [
      now - A2A_STALE_TASK_LOOKBACK_MS,
      now - queuedLifetimeMaxMs,
      now - processingStuckAfterMs,
      now - processingLifetimeMaxMs,
    ],
  });
  const row = rows[0] as Record<string, unknown> | undefined;
  if (row?.stale_tasks === null || row?.stale_tasks === undefined) {
    throw new Error("The A2A task count query returned no count.");
  }
  const count = Number(row.stale_tasks);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("The A2A task count query returned an invalid count.");
  }
  return count;
}

/** Use one owner/admin only when the app has an unambiguous org scope. */
async function alertOwner(): Promise<AlertRecipient | null> {
  const { rows } = await getDbExec().execute({
    sql: `SELECT org_id, email, role FROM org_members
          WHERE role IN ('owner', 'admin')
            AND federation_removal_pending_at IS NULL
          ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, email`,
    args: [],
  });
  const orgIds = new Set(
    rows.map((row) => String((row as Record<string, unknown>).org_id ?? "")),
  );
  if (orgIds.size !== 1 || orgIds.has("")) return null;
  const recipient = rows.find((row) => {
    const role = (row as Record<string, unknown>).role;
    return role === "owner" || role === "admin";
  });
  const email = String(
    (recipient as Record<string, unknown> | undefined)?.email ?? "",
  );
  const [orgId] = [...orgIds];
  return email && orgId ? { owner: email, orgId } : null;
}

async function releaseAlertClaim(
  claimId: string,
  claimExpiresAt: number,
): Promise<string | null> {
  try {
    await deleteSettingIfValue(LAST_ALERT_SETTING_KEY, {
      claimId,
      claimExpiresAt,
    });
    return null;
  } catch (error) {
    const reason = "The Slack alert claim could not be released.";
    console.error(`[chat-health-alert] ${reason}`, error);
    return reason;
  }
}

export async function checkChatHealthAndAlert(
  now: number = Date.now(),
): Promise<ChatHealthAlertOutcome> {
  let counts: TurnCounts;
  let staleA2ATasks: number;
  try {
    [counts, staleA2ATasks] = await Promise.all([
      countRecentTurns(now - WINDOW_MS),
      countStaleA2ATasks(now),
    ]);
  } catch (error) {
    return { status: "check-failed", reason: String(error) };
  }

  if (counts.turns < MIN_TURNS && staleA2ATasks === 0) {
    return { status: "insufficient-data", turns: counts.turns };
  }

  const badRate = counts.turns > 0 ? counts.bad / counts.turns : 0;
  const badTurnRate =
    counts.turns >= MIN_TURNS && badRate >= BAD_RATE_THRESHOLD;
  if (!badTurnRate && staleA2ATasks === 0) {
    return { status: "healthy", turns: counts.turns, badRate };
  }

  const claimId = randomUUID();
  const claimExpiresAt = now + CLAIM_LEASE_MS;
  let claim: Record<string, unknown>;
  try {
    claim = await mutateSetting(LAST_ALERT_SETTING_KEY, (current) => {
      const lastPagedAt = Number(current?.at ?? 0);
      const existingClaimExpiresAt = Number(current?.claimExpiresAt ?? 0);
      if (
        (Number.isFinite(lastPagedAt) && now - lastPagedAt < COOLDOWN_MS) ||
        (Number.isFinite(existingClaimExpiresAt) &&
          existingClaimExpiresAt > now)
      ) {
        return current ?? {};
      }
      return { claimId, claimExpiresAt };
    });
  } catch (error) {
    return { status: "check-failed", reason: String(error) };
  }

  if (String(claim.claimId ?? "") !== claimId) {
    const lastPagedAt = Number(claim.at ?? 0);
    const retryAfterMs =
      Number.isFinite(lastPagedAt) && now - lastPagedAt < COOLDOWN_MS
        ? COOLDOWN_MS - (now - lastPagedAt)
        : Math.max(0, Number(claim.claimExpiresAt ?? 0) - now);
    return {
      status: "cooldown",
      retryAfterMs,
    };
  }

  let recipient: AlertRecipient | null;
  try {
    recipient = await alertOwner();
  } catch (error) {
    const releaseReason = await releaseAlertClaim(claimId, claimExpiresAt);
    return {
      status: "check-failed",
      reason: releaseReason
        ? `${String(error)} ${releaseReason}`
        : String(error),
    };
  }
  if (!recipient) {
    const reason =
      "No single owner/admin organization scope is available for Slack health alerts.";
    const releaseReason = await releaseAlertClaim(claimId, claimExpiresAt);
    return {
      status: "delivery-failed",
      reason: releaseReason ? `${reason} ${releaseReason}` : reason,
    };
  }

  const pct = Math.round(badRate * 100);
  const title =
    staleA2ATasks > 0
      ? `${staleA2ATasks} stale delegated A2A task${staleA2ATasks === 1 ? "" : "s"}`
      : `Chat is failing: ${pct}% of turns ended without an answer`;
  const details = [
    badTurnRate
      ? `${counts.bad} of ${counts.turns} turns in the last hour ended without an answer.`
      : "",
    staleA2ATasks > 0
      ? `${staleA2ATasks} delegated A2A task${staleA2ATasks === 1 ? " is" : "s are"} past the recovery window.`
      : "",
  ].filter(Boolean);
  let samples = "";
  if (badTurnRate) {
    try {
      const lines = await sampleFailedRuns(now - WINDOW_MS);
      if (lines.length > 0) {
        samples =
          ` Latest failed turns:\n${lines.join("\n")}\n` +
          `Inspect one with get-agent-thread-debug (pass its run id).`;
      }
    } catch (error) {
      // The alert is worth sending without examples, and says so.
      samples = ` Latest failed turns could not be read: ${String(error)}.`;
    }
  }
  let delivery: Awaited<ReturnType<typeof notifyWithDelivery>>;
  try {
    delivery = await runWithRequestContext(
      { userEmail: recipient.owner, orgId: recipient.orgId },
      () =>
        notifyWithDelivery(
          {
            severity: "critical",
            title,
            body:
              `${details.join(" ")} Run \`node scripts/chat-health.mjs --hours 1\` for the ` +
              `per-reason breakdown.${samples}`,
            channels: ["slack"],
            metadata: {
              turns: counts.turns,
              bad: counts.bad,
              badRate,
              staleA2ATasks,
              windowMs: WINDOW_MS,
            },
          },
          { owner: recipient.owner },
        ),
    );
  } catch (error) {
    console.error("[chat-health-alert] Slack delivery failed:", error);
    const releaseReason = await releaseAlertClaim(claimId, claimExpiresAt);
    return {
      status: "delivery-failed",
      reason: releaseReason
        ? `${String(error)} ${releaseReason}`
        : String(error),
    };
  }

  if (!delivery.deliveredChannels.includes("slack")) {
    const reason = "Slack health alert was not delivered.";
    console.error(`[chat-health-alert] ${reason}`);
    const releaseReason = await releaseAlertClaim(claimId, claimExpiresAt);
    return {
      status: "delivery-failed",
      reason: releaseReason ? `${reason} ${releaseReason}` : reason,
    };
  }

  try {
    const finalized = await mutateSetting(LAST_ALERT_SETTING_KEY, (current) =>
      String(current?.claimId ?? "") === claimId
        ? { at: now, claimId }
        : (current ?? {}),
    );
    if (String(finalized.claimId ?? "") !== claimId) {
      const reason =
        "Slack delivered, but its alert cooldown claim was lost before persistence.";
      console.error(`[chat-health-alert] ${reason}`);
      return { status: "persistence-failed", reason };
    }
  } catch (error) {
    const reason =
      "Slack delivered, but the alert cooldown could not be persisted.";
    console.error("[chat-health-alert] could not stamp cooldown:", error);
    return { status: "persistence-failed", reason };
  }

  return {
    status: "alerted",
    turns: counts.turns,
    badRate,
    staleA2ATasks,
    recipients: 1,
  };
}
