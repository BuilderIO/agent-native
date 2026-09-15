import { randomUUID } from "node:crypto";

import { getDbExec } from "../db/client.js";
import { notifyWithDelivery } from "../notifications/registry.js";
import { runWithRequestContext } from "../server/request-context.js";
import { deleteSettingIfValue, mutateSetting } from "../settings/store.js";

/**
 * Sends one Slack alert when an app's chat stops answering.
 *
 * The detector for this already existed as `scripts/chat-health.mjs --strict`,
 * correctly calibrated and exiting 1 on a partial outage — but nothing ever ran
 * it and nothing ever paged, so an app answering 11% of its turns was found by
 * a user posting in Slack. This is the missing half: the same measurement, on
 * the durable sweep that already drives stale reaping, scoped to the one app it
 * runs in so no cross-app credential has to exist anywhere.
 */

/** Turns are scored over this window on every sweep. */
const WINDOW_MS = 60 * 60_000;
/**
 * Below this, a rate is noise: one failed turn out of two is 50% and means
 * nothing. Chat-health's own fleet view showed apps sitting at 100% on a single
 * turn all day.
 */
const MIN_TURNS = 5;
/**
 * Deliberately far above `chat-health`'s 0.1 review budget. That threshold
 * answers "is this app degraded", which is a question for a dashboard. This one
 * answers "is chat down", which is the only question worth waking someone for.
 */
const BAD_RATE_THRESHOLD = 0.5;
/** One page per outage, not one per sweep. */
const COOLDOWN_MS = 60 * 60_000;
/** Slack sends time out well inside this lease; failed sends release it early. */
const CLAIM_LEASE_MS = 5 * 60_000;

const LAST_ALERT_SETTING_KEY = "chat-health-alert:last-slack-alert-at";

/**
 * Every outcome is distinguishable. "Not enough turns to judge" and "healthy"
 * are different answers, and a check that could not run is neither — collapsing
 * them is how a monitor reports all-clear through an outage.
 */
export type ChatHealthAlertOutcome =
  | { status: "healthy"; turns: number; badRate: number }
  | { status: "insufficient-data"; turns: number }
  | { status: "cooldown"; retryAfterMs: number }
  | { status: "alerted"; turns: number; badRate: number; recipients: number }
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

/**
 * Scores the LAST run of each turn in the window, matching how
 * `scripts/chat-health.mjs` reports so a page and the CLI never disagree.
 * User-stopped turns are excluded: someone hitting Stop is not an outage.
 */
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
  try {
    counts = await countRecentTurns(now - WINDOW_MS);
  } catch (error) {
    // A check that could not read the ledger has not found the app healthy.
    return { status: "check-failed", reason: String(error) };
  }

  if (counts.turns < MIN_TURNS) {
    return { status: "insufficient-data", turns: counts.turns };
  }

  const badRate = counts.bad / counts.turns;
  if (badRate < BAD_RATE_THRESHOLD) {
    return { status: "healthy", turns: counts.turns, badRate };
  }

  // Claim the page before awaiting the external send. The short lease keeps
  // overlapping sweeps from both sending; failed sends release it below,
  // while a crashed send becomes retryable after the lease.
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
  let delivery: Awaited<ReturnType<typeof notifyWithDelivery>>;
  try {
    delivery = await runWithRequestContext(
      { userEmail: recipient.owner, orgId: recipient.orgId },
      () =>
        notifyWithDelivery(
          {
            severity: "critical",
            title: `Chat is failing: ${pct}% of turns ended without an answer`,
            body:
              `${counts.bad} of ${counts.turns} turns in the last hour ended without ` +
              `an answer. Run \`node scripts/chat-health.mjs --hours 1\` for the ` +
              `per-reason breakdown.`,
            channels: ["slack"],
            metadata: {
              turns: counts.turns,
              bad: counts.bad,
              badRate,
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

  // Finalize only after Slack confirms delivery. The claim id keeps a slow or
  // expired sender from overwriting a newer claim's cooldown.
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
    recipients: 1,
  };
}
