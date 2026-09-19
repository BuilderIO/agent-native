/**
 * Shared plumbing for collaboration emails (comments, replies, reactions,
 * mentions).
 *
 * Two things every app was about to reimplement live here: resolving who
 * should receive an activity email, and reporting delivery honestly. A
 * workspace with no email provider is a *different* outcome from "nobody
 * wanted this email" — collapsing both into an empty success is what let a
 * dead notification toggle ship unnoticed.
 */

import { getUserSetting } from "../settings/user-settings.js";
import { isEmailConfigured } from "./email.js";

export type ActivityDeliveryFailure = { email: string; error: string };

export type ActivityNotificationStatus =
  | "delivered"
  | "delivery-failed"
  | "email-not-configured"
  | "no-recipients"
  | "notification-error";

export type ActivityNotificationResult = {
  status: ActivityNotificationStatus;
  sent: string[];
  failed: ActivityDeliveryFailure[];
  /** Set only on `notification-error`: why recipients could not be resolved. */
  error?: string;
};

/** Default field read from an app's per-user preference blob. */
const DEFAULT_PREFERENCE_FIELD = "emailNotifications";

export interface ResolveActivityRecipientsInput {
  /** Owner, thread participants, mentions — duplicates and blanks are fine. */
  candidates: (string | null | undefined)[];
  /** The person who caused the activity. Never emailed about their own action. */
  actorEmail?: string | null;
  /** App-owned user settings key, e.g. `clips-user-prefs`. */
  preferenceKey: string;
  /** Field inside that blob. Absent or non-`false` means opted in. */
  preferenceField?: string;
}

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

async function wantsActivityEmail(
  email: string,
  preferenceKey: string,
  preferenceField: string,
): Promise<boolean> {
  const prefs = await getUserSetting(email, preferenceKey);
  // A user who never opened settings has no stored blob; treat that as opted
  // in rather than silently dropping their notifications.
  return prefs?.[preferenceField] !== false;
}

/**
 * Normalize, dedupe, drop the actor, and filter by each recipient's stored
 * preference. Order follows first appearance in `candidates`.
 */
export async function resolveActivityRecipients({
  candidates,
  actorEmail,
  preferenceKey,
  preferenceField = DEFAULT_PREFERENCE_FIELD,
}: ResolveActivityRecipientsInput): Promise<string[]> {
  const actor = normalizeEmail(actorEmail);
  const unique = new Set<string>();
  for (const candidate of candidates) {
    const email = normalizeEmail(candidate);
    if (!email || email === actor || !email.includes("@")) continue;
    unique.add(email);
  }

  const decisions = await Promise.all(
    [...unique].map(async (email) =>
      (await wantsActivityEmail(email, preferenceKey, preferenceField))
        ? email
        : null,
    ),
  );
  return decisions.filter((email): email is string => email !== null);
}

export interface NotifyActivityInput extends ResolveActivityRecipientsInput {
  /** Sends one email. Throwing marks that recipient failed, not the batch. */
  send: (to: string) => Promise<unknown>;
  /** Prefix for the delivery-failure log line, e.g. `[slides]`. */
  logLabel?: string;
}

/**
 * Resolve recipients and deliver one email each. Returns a status that
 * distinguishes "no email provider" from "nobody to email" from a real send.
 */
export async function notifyActivity({
  send,
  logLabel,
  ...resolve
}: NotifyActivityInput): Promise<ActivityNotificationResult> {
  if (!(await isEmailConfigured())) {
    return { status: "email-not-configured", sent: [], failed: [] };
  }

  const recipients = await resolveActivityRecipients(resolve);
  if (recipients.length === 0) {
    return { status: "no-recipients", sent: [], failed: [] };
  }

  const sent: string[] = [];
  const failed: ActivityDeliveryFailure[] = [];
  for (const to of recipients) {
    try {
      await send(to);
      sent.push(to);
    } catch (error) {
      failed.push({
        email: to,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (failed.length > 0) {
    console.error(
      `${logLabel ?? "[activity-notifications]"} delivery failed for ${failed
        .map((failure) => `${failure.email} (${failure.error})`)
        .join(", ")}`,
    );
  }

  // Every recipient failing is an outage, not a delivery. Callers that log or
  // surface this must not see it as the same outcome as a successful send.
  return {
    status: sent.length === 0 ? "delivery-failed" : "delivered",
    sent,
    failed,
  };
}

/**
 * Run an activity notification without letting it fail the write that caused
 * it. The comment/reaction is already persisted by the time notification runs;
 * rejecting here makes the client roll back and retry, which duplicates the
 * row. The error still surfaces — as a distinct `notification-error` status,
 * never as a silent success.
 */
export async function runActivityNotification<
  T extends {
    status: string;
    sent: string[];
    failed: ActivityDeliveryFailure[];
  },
>(
  logLabel: string,
  resolve: () => Promise<T>,
): Promise<T | ActivityNotificationResult> {
  try {
    return await resolve();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${logLabel} could not be resolved: ${message}`);
    return {
      status: "notification-error",
      error: message,
      sent: [],
      failed: [],
    };
  }
}
