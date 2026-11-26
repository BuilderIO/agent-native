import { getUserSetting, mutateUserSetting } from "@agent-native/core/settings";

import type { ExternalCalendar } from "../../shared/api.js";
import {
  normalizeCalendarDescription,
  withFeedDescription,
} from "../../shared/calendar-descriptions.js";
import { mutateExternalCalendars } from "./external-calendars.js";

const ACCOUNT_DESCRIPTIONS_KEY = "calendar-account-descriptions";

function accountKey(email: string): string {
  return email.trim().toLowerCase();
}

function readAccountDescriptions(stored: unknown): Record<string, string> {
  const descriptions: Record<string, string> = {};
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) {
    return descriptions;
  }
  for (const [email, value] of Object.entries(stored)) {
    const description = normalizeCalendarDescription(value);
    if (description) descriptions[accountKey(email)] = description;
  }
  return descriptions;
}

export async function getAccountDescriptions(
  owner: string,
): Promise<Record<string, string>> {
  return readAccountDescriptions(
    await getUserSetting(owner, ACCOUNT_DESCRIPTIONS_KEY),
  );
}

export function accountDescriptionFor(
  descriptions: Record<string, string>,
  email: string | undefined,
): string | undefined {
  return email ? descriptions[accountKey(email)] : undefined;
}

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

export async function setFeedDescription(
  owner: string,
  feedId: string,
  description: string | undefined,
): Promise<ExternalCalendar | null> {
  let updated: ExternalCalendar | null = null;
  await mutateExternalCalendars(owner, (feeds) =>
    feeds.map((feed) => {
      if (feed.id !== feedId) return feed;
      const changed = withFeedDescription(feed, description);
      updated = changed;
      return changed;
    }),
  );
  return updated;
}
