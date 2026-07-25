import { getRequestTimezone } from "@agent-native/core/server";
import type { Settings } from "../../shared/api.js";

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
  return {
    timezone: defaultTimezone(),
    bookingPageTitle: "Book a Meeting",
    bookingPageDescription: "Select a time that works for you.",
    defaultEventDuration: 30,
  };
}
