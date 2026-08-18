import { getRequestTimezone } from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";

import type { Settings } from "../../shared/api.js";
import { DEFAULT_SETTINGS } from "../../shared/settings.js";

function defaultTimezone() {
  const timezone = getRequestTimezone();
  if (!timezone) return "America/New_York";

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return timezone;
  } catch {
    return "America/New_York";
  }
}

export function getDefaultSettings(): Settings {
  return { ...DEFAULT_SETTINGS, timezone: defaultTimezone() };
}

export function isCalendarTimezone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export async function getCalendarTimezone(email: string): Promise<string> {
  const settings = (await getUserSetting(email, "calendar-settings")) as {
    timezone?: unknown;
  } | null;
  if (settings?.timezone === undefined) return getDefaultSettings().timezone;
  if (!isCalendarTimezone(settings.timezone)) {
    throw new Error("Saved calendar timezone must be a valid IANA timezone.");
  }
  return settings.timezone;
}
