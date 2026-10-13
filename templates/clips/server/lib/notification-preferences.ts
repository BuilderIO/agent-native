import {
  decryptSecretValue,
  encryptSecretValue,
} from "@agent-native/core/secrets";
import { getUserSetting } from "@agent-native/core/settings";

import { CLIPS_USER_PREFS_KEY } from "../../shared/clips-ai-prefs.js";
import {
  isClipsNotificationEnabled,
  type ClipsNotificationCategory,
  type ClipsNotificationPrefs,
} from "../../shared/clips-notification-prefs.js";

const NOTIFICATION_OPT_OUT_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ClipsNotificationOptOutClaims {
  email: string;
  category: ClipsNotificationCategory;
  expiresAt: number;
}

export function normalizeClipsNotificationEmail(
  value: string | null | undefined,
): string | null {
  const email = value?.trim().toLowerCase() ?? "";
  return EMAIL_PATTERN.test(email) ? email : null;
}

export function createClipsNotificationOptOutToken(
  email: string,
  category: ClipsNotificationCategory,
): string {
  const normalizedEmail = normalizeClipsNotificationEmail(email);
  if (!normalizedEmail)
    throw new Error("Cannot create token for invalid email");

  return encryptSecretValue(
    JSON.stringify({
      email: normalizedEmail,
      category,
      expiresAt: Date.now() + NOTIFICATION_OPT_OUT_TTL_MS,
    } satisfies ClipsNotificationOptOutClaims),
  );
}

export function readClipsNotificationOptOutToken(
  token: string | null | undefined,
  category: ClipsNotificationCategory,
): ClipsNotificationOptOutClaims | null {
  if (!token) return null;
  try {
    const claims = JSON.parse(
      decryptSecretValue(token),
    ) as Partial<ClipsNotificationOptOutClaims>;
    const email = normalizeClipsNotificationEmail(claims.email);
    if (
      !email ||
      claims.category !== category ||
      typeof claims.expiresAt !== "number" ||
      claims.expiresAt < Date.now()
    ) {
      return null;
    }
    return { email, category, expiresAt: claims.expiresAt };
    // coercion-ok: malformed or expired bearer tokens are an expected absent value
  } catch {
    return null;
  }
}

export async function filterClipsNotificationRecipients(
  candidates: readonly (string | null | undefined)[],
  category: ClipsNotificationCategory,
): Promise<string[]> {
  const recipients = [
    ...new Set(
      candidates
        .map(normalizeClipsNotificationEmail)
        .filter((email): email is string => email !== null),
    ),
  ];
  const decisions = await Promise.all(
    recipients.map(async (email) => {
      const prefs = (await getUserSetting(
        email,
        CLIPS_USER_PREFS_KEY,
      )) as ClipsNotificationPrefs | null;
      return isClipsNotificationEnabled(prefs, category) ? email : null;
    }),
  );
  return decisions.filter((email): email is string => email !== null);
}
