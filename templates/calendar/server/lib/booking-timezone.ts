import { getUserSetting } from "@agent-native/core/settings";

import type { AvailabilityConfig } from "../../shared/api.js";

export const DEFAULT_BOOKING_TIMEZONE = "America/New_York";

export function safeBookingTimeZone(value: unknown): string | undefined {
  const timeZone = typeof value === "string" ? value.trim() : "";
  if (!timeZone) return undefined;

  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return undefined;
  }
}

export async function getOwnerBookingTimeZone(
  ownerEmail?: string,
): Promise<string> {
  if (!ownerEmail) return DEFAULT_BOOKING_TIMEZONE;

  const [availabilitySetting, calendarSettings] = await Promise.all([
    getUserSetting(ownerEmail, "calendar-availability"),
    getUserSetting(ownerEmail, "calendar-settings"),
  ]);
  const availability =
    availabilitySetting as unknown as AvailabilityConfig | null;
  const settings = calendarSettings as { timezone?: string } | null;

  return (
    safeBookingTimeZone(availability?.timezone) ||
    safeBookingTimeZone(settings?.timezone) ||
    DEFAULT_BOOKING_TIMEZONE
  );
}
