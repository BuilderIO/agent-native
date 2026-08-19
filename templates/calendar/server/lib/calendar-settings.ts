import { getRequestTimezone } from "@agent-native/core/server";
import {
  getSetting,
  getUserSetting,
  putSetting,
  putUserSetting,
} from "@agent-native/core/settings";

import type { Settings } from "../../shared/api.js";
import {
  DEFAULT_SETTINGS,
  normalizeCalendarSettings,
} from "../../shared/settings.js";
import { isCalendarTimezone } from "../../shared/timezone.js";

const SETTINGS_KEY = "calendar-settings";

function callerTimezone(): string {
  const timezone = getRequestTimezone();
  return isCalendarTimezone(timezone) ? timezone : DEFAULT_SETTINGS.timezone;
}

export async function readCalendarSettings(email: string): Promise<Settings> {
  return normalizeCalendarSettings(await getUserSetting(email, SETTINGS_KEY), {
    timezone: callerTimezone(),
  });
}

/**
 * Settings for the public booking page. The fixed default applies here rather
 * than the caller's zone: a visitor must not shift the owner's booking times.
 */
export async function readPublicCalendarSettings(): Promise<Settings> {
  return normalizeCalendarSettings(await getSetting(SETTINGS_KEY));
}

/** Merge a patch over the stored settings and persist the whole record. */
export async function saveCalendarSettings(
  email: string,
  patch: unknown,
): Promise<Settings> {
  const settings = normalizeCalendarSettings(
    {
      ...(await readCalendarSettings(email)),
      ...(patch && typeof patch === "object" ? patch : {}),
    },
    { timezone: callerTimezone() },
  );
  const record = settings as unknown as Record<string, unknown>;
  await putUserSetting(email, SETTINGS_KEY, record);
  // Also write the global key so the public booking page can read it.
  await putSetting(SETTINGS_KEY, record);
  return settings;
}

/** The timezone to compute event ranges in — always a valid IANA zone. */
export async function getCalendarTimezone(email: string): Promise<string> {
  return (await readCalendarSettings(email)).timezone;
}
