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
  error?: string;
};

const DEFAULT_PREFERENCE_FIELD = "emailNotifications";

export interface ResolveActivityRecipientsInput {
  candidates: (string | null | undefined)[];
  actorEmail?: string | null;
  preferenceKey: string;
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
  return prefs?.[preferenceField] !== false;
}

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
  send: (to: string) => Promise<unknown>;
  logLabel?: string;
}

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

  return {
    status: sent.length === 0 ? "delivery-failed" : "delivered",
    sent,
    failed,
  };
}

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
