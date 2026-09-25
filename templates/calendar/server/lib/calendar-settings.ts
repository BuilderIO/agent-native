import { getRequestTimezone } from "@agent-native/core/server";
import {
  getSetting,
  getUserSetting,
  mutateUserSetting,
  putSetting,
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
      // Only this user's own record — the shared/global key backs the
      // public booking page and must only change from an explicit save
      // (`saveCalendarSettings`), not as a side effect of any user's read.
      //
      // Atomic read-modify-write: `raw` above can be stale by the time this
      // runs (a concurrent `saveCalendarSettings` may have written a real
      // record in between). Re-check inside the same atomic update instead
      // of unconditionally overwriting whatever is there now.
      const record = settings as unknown as Record<string, unknown>;
      await mutateUserSetting(
        email,
        SETTINGS_KEY,
        (current) => current ?? record,
      );
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
  const patchRecord =
    patch && typeof patch === "object"
      ? (patch as Record<string, unknown>)
      : {};
  const storedSettings = await mutateUserSetting(
    email,
    SETTINGS_KEY,
    (current) => {
      const currentRecord = current ?? {};
      const currentSettings = normalizeCalendarSettings(currentRecord, {
        timezone: callerTimezone(),
      });
      return {
        ...normalizeCalendarSettings(
          {
            ...currentSettings,
            ...patchRecord,
            eventRules: {
              ...currentSettings.eventRules,
              ...((patchRecord.eventRules as
                | Record<string, unknown>
                | undefined) ?? {}),
            },
          },
          { timezone: callerTimezone() },
        ),
        ...(currentRecord.__calendarEventRuleUndoClaims !== undefined
          ? {
              __calendarEventRuleUndoClaims:
                currentRecord.__calendarEventRuleUndoClaims,
            }
          : {}),
      } as unknown as Record<string, unknown>;
    },
  );
  const settings = normalizeCalendarSettings(storedSettings);
  const record = settings as unknown as Record<string, unknown>;
  const publicRecord = { ...record };
  delete publicRecord.eventRules;
  delete publicRecord.hiddenEventKeys;
  delete publicRecord.eventRuleActivity;
  // `mutateUserSetting` already persisted the private record atomically. A
  // second whole-record write here could overwrite activity recorded between
  // the mutation and this public-settings update.
  await putSetting(SETTINGS_KEY, publicRecord);
  return settings;
}

/** The timezone to compute event ranges in — always a valid IANA zone. */
export async function getCalendarTimezone(email: string): Promise<string> {
  return (await readCalendarSettings(email)).timezone;
}
