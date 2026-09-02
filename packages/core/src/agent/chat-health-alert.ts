import { getDbExec } from "../db/client.js";
import { notifyWithDelivery } from "../notifications/registry.js";
import { getSetting, putSetting } from "../settings/store.js";

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
  | { status: "check-failed"; reason: string };

interface TurnCounts {
  turns: number;
  bad: number;
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

/** Use one owner/admin so a shared Slack webhook gets one alert, not duplicates. */
async function alertOwner(): Promise<string | null> {
  const { rows } = await getDbExec().execute({
    sql: `SELECT email FROM org_members
          WHERE role IN ('owner', 'admin')
          ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, email
          LIMIT 1`,
    args: [],
  });
  const email = String(
    (rows[0] as Record<string, unknown> | undefined)?.email ?? "",
  );
  return email || null;
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

  // A cooldown stamp we could not READ is not a cooldown that is absent:
  // treating it as absent pages on every sweep for as long as settings stay
  // unreadable, which is exactly the spam the cooldown exists to prevent.
  let stored: Record<string, unknown> | null;
  try {
    stored = (await getSetting(LAST_ALERT_SETTING_KEY)) as Record<
      string,
      unknown
    > | null;
  } catch (error) {
    return { status: "check-failed", reason: String(error) };
  }
  const lastPagedAt = Number(stored?.at ?? 0);
  if (Number.isFinite(lastPagedAt) && now - lastPagedAt < COOLDOWN_MS) {
    return {
      status: "cooldown",
      retryAfterMs: COOLDOWN_MS - (now - lastPagedAt),
    };
  }

  let owner: string | null;
  try {
    owner = await alertOwner();
  } catch (error) {
    return { status: "check-failed", reason: String(error) };
  }
  if (!owner) {
    return {
      status: "delivery-failed",
      reason: "No owner or admin is configured for Slack health alerts.",
    };
  }

  const pct = Math.round(badRate * 100);
  let delivery: Awaited<ReturnType<typeof notifyWithDelivery>>;
  try {
    delivery = await notifyWithDelivery(
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
      { owner },
    );
  } catch (error) {
    console.error("[chat-health-alert] Slack delivery failed:", error);
    return { status: "delivery-failed", reason: String(error) };
  }

  if (!delivery.deliveredChannels.includes("slack")) {
    const reason = "Slack health alert was not delivered.";
    console.error(`[chat-health-alert] ${reason}`);
    return { status: "delivery-failed", reason };
  }

  // Stamp only after Slack confirms delivery, so a failed alert retries on the
  // next sweep instead of being silenced by its own cooldown.
  await putSetting(LAST_ALERT_SETTING_KEY, { at: now }).catch(
    (error: unknown) => {
      console.error("[chat-health-alert] could not stamp cooldown:", error);
    },
  );

  return {
    status: "alerted",
    turns: counts.turns,
    badRate,
    recipients: 1,
  };
}
