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
      await mutateUserSetting(
        email,
        SETTINGS_KEY,
        (current) => current ?? record,
      );
    }
  }
  return settings;
}

export async function readPublicCalendarSettings(): Promise<Settings> {
  return normalizeCalendarSettings(await getSetting(SETTINGS_KEY));
}

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
  await putSetting(SETTINGS_KEY, publicRecord);
  return settings;
}

export async function getCalendarTimezone(email: string): Promise<string> {
  return (await readCalendarSettings(email)).timezone;
}
