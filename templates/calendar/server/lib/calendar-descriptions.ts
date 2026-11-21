import { getUserSetting, mutateUserSetting } from "@agent-native/core/settings";

import type { ExternalCalendar } from "../../shared/api.js";
import { normalizeCalendarDescription } from "../../shared/calendar-descriptions.js";

const ACCOUNT_DESCRIPTIONS_KEY = "calendar-account-descriptions";
const EXTERNAL_CALENDARS_KEY = "external-calendars";

function accountKey(email: string): string {
  return email.trim().toLowerCase();
}

function readAccountDescriptions(
  stored: Record<string, unknown> | null,
): Record<string, string> {
  const descriptions: Record<string, string> = {};
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return descriptions;
  }
  for (const [email, value] of Object.entries(stored)) {
    const description = normalizeCalendarDescription(value);
    if (description) descriptions[accountKey(email)] = description;
  }
  return descriptions;
}

/**
 * The owner's descriptions of their connected Google accounts, keyed by
 * lowercased account email. Agents read them to choose the right account.
 * A failed read returns none, so schedule and status reads still answer.
 */
export async function getAccountDescriptions(
  owner: string,
): Promise<Record<string, string>> {
  try {
    return readAccountDescriptions(
      await getUserSetting(owner, ACCOUNT_DESCRIPTIONS_KEY),
    );
  } catch (error) {
    console.warn("[calendar] couldn't read account descriptions", error);
    return {};
  }
}

/** One account's description from {@link getAccountDescriptions}, if any. */
export function accountDescriptionFor(
  descriptions: Record<string, string>,
  email: string | undefined,
): string | undefined {
  return email ? descriptions[accountKey(email)] : undefined;
}

/** Saves or, with no description, clears one account's description. */
export async function setAccountDescription(
  owner: string,
  accountEmail: string,
  description: string | undefined,
): Promise<void> {
  await mutateUserSetting(owner, ACCOUNT_DESCRIPTIONS_KEY, (current) => {
    const descriptions = readAccountDescriptions(current);
    const key = accountKey(accountEmail);
    if (description) descriptions[key] = description;
    else delete descriptions[key];
    return descriptions;
  });
}

/**
 * Saves or clears one subscribed feed's description. Returns the updated
 * feed, or null when the owner has no feed with that id.
 */
export async function setFeedDescription(
  owner: string,
  feedId: string,
  description: string | undefined,
): Promise<ExternalCalendar | null> {
  let updated: ExternalCalendar | null = null;
  await mutateUserSetting(owner, EXTERNAL_CALENDARS_KEY, (current) => {
    const feeds = Array.isArray(current)
      ? (current as unknown as ExternalCalendar[])
      : [];
    const next = feeds.map((feed) => {
      if (feed.id !== feedId) return feed;
      const changed: ExternalCalendar = { ...feed };
      if (description) changed.description = description;
      else delete changed.description;
      updated = changed;
      return changed;
    });
    return next as unknown as Record<string, unknown>;
  });
  return updated;
}
