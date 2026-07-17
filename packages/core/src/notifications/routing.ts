import { getUserSetting, putUserSetting } from "../settings/user-settings.js";
import { notifyWithDelivery } from "./registry.js";
import type { NotificationInput, NotificationMeta } from "./types.js";

const SETTING_KEY = "notification-routing";
const SECRET_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;

export interface PersonalNotificationRouting {
  inbox: boolean;
  browser: boolean;
  email: boolean;
  personalSlack: boolean;
  /** Name of a user-scoped secret containing a Slack incoming-webhook URL. */
  personalSlackWebhookKey: string | null;
}

export const DEFAULT_PERSONAL_NOTIFICATION_ROUTING: PersonalNotificationRouting =
  {
    inbox: true,
    browser: true,
    email: false,
    personalSlack: false,
    personalSlackWebhookKey: null,
  };

export async function getPersonalNotificationRouting(
  owner: string,
): Promise<PersonalNotificationRouting> {
  const stored = await getUserSetting(owner, SETTING_KEY);
  return normalizePersonalNotificationRouting(stored);
}

export async function setPersonalNotificationRouting(
  owner: string,
  input: unknown,
): Promise<PersonalNotificationRouting> {
  const routing = normalizePersonalNotificationRouting(input, true);
  await putUserSetting(owner, SETTING_KEY, { ...routing });
  return routing;
}

export async function notifyPersonalWithDelivery(
  input: Omit<NotificationInput, "channels">,
  meta: NotificationMeta,
) {
  const routing = await getPersonalNotificationRouting(meta.owner);
  const channels: string[] = [];
  if (routing.inbox) channels.push("inbox");
  if (routing.email) channels.push("email");
  if (routing.personalSlack && routing.personalSlackWebhookKey) {
    channels.push("personal-slack");
  }

  const delivery =
    routing.email || (routing.personalSlack && routing.personalSlackWebhookKey)
      ? {
          ...(routing.email ? { emailRecipients: [meta.owner] } : {}),
          ...(routing.personalSlack && routing.personalSlackWebhookKey
            ? {
                personalSlackWebhookUrl: `\${keys.${routing.personalSlackWebhookKey}}`,
              }
            : {}),
        }
      : undefined;

  return notifyWithDelivery(
    {
      ...input,
      channels,
      metadata: delivery ? { ...input.metadata, delivery } : input.metadata,
    },
    meta,
  );
}

export function normalizePersonalNotificationRouting(
  input: unknown,
  strict = false,
): PersonalNotificationRouting {
  const value = isRecord(input) ? input : {};
  const key = normalizeSecretKey(value.personalSlackWebhookKey);
  const personalSlack = booleanValue(value.personalSlack, false);
  if (strict && personalSlack && !key) {
    throw new Error(
      "A personal Slack webhook secret key is required when personal Slack delivery is enabled.",
    );
  }
  if (
    strict &&
    value.personalSlackWebhookKey != null &&
    value.personalSlackWebhookKey !== "" &&
    !key
  ) {
    throw new Error(
      "Personal Slack webhook secret keys must use uppercase letters, numbers, and underscores.",
    );
  }

  const inbox = booleanValue(value.inbox, true);
  return {
    inbox,
    browser: inbox && booleanValue(value.browser, true),
    email: booleanValue(value.email, false),
    personalSlack,
    personalSlackWebhookKey: key,
  };
}

function normalizeSecretKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const placeholder = /^\$\{keys\.([A-Z][A-Z0-9_]{0,127})\}$/.exec(
    value.trim(),
  );
  const key = placeholder?.[1] ?? value.trim();
  return SECRET_KEY_PATTERN.test(key) ? key : null;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
