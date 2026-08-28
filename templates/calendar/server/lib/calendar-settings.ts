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

/**
 * `persistDetected` saves the browser-detected time zone the first time this
 * user has no stored settings, so peers who overlay this user's calendar (and
 * the public booking page) can resolve their zone without them ever opening
 * Settings. Only call this from the actual settings-read surfaces (the
 * `get-settings` action and its route handler) — internal callers like
 * `getCalendarTimezone` must stay side-effect-free since they run on every
 * event read for any request-context email, not only the signed-in owner.
 */
export async function readCalendarSettings(
  email: string,
  options?: { persistDetected?: boolean },
): Promise<Settings> {
  const raw = await getUserSetting(email, SETTINGS_KEY);
  const settings = normalizeCalendarSettings(raw, {
    timezone: callerTimezone(),
  });
  if (options?.persistDetected && !raw) {
    const detected = getRequestTimezone();
    if (isCalendarTimezone(detected)) {
      const record = settings as unknown as Record<string, unknown>;
      await Promise.all([
        putUserSetting(email, SETTINGS_KEY, record),
        putSetting(SETTINGS_KEY, record),
      ]);
    }
  }
  return settings;
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
  const settings = normalizeCalendarSettings({
    ...(await readCalendarSettings(email)),
    ...(patch && typeof patch === "object" ? patch : {}),
  });
  const record = settings as unknown as Record<string, unknown>;
  await Promise.all([
    putUserSetting(email, SETTINGS_KEY, record),
    // Also write the global key so the public booking page can read it.
    putSetting(SETTINGS_KEY, record),
  ]);
  return settings;
}

/** The timezone to compute event ranges in — always a valid IANA zone. */
export async function getCalendarTimezone(email: string): Promise<string> {
  return (await readCalendarSettings(email)).timezone;
}
