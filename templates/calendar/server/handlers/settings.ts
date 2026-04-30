import { defineEventHandler, setResponseStatus, type H3Event } from "h3";
import type { Settings } from "../../shared/api.js";
import {
  getUserSetting,
  putUserSetting,
  putSetting,
} from "@agent-native/core/settings";
import { readBody, getSession } from "@agent-native/core/server";

const DEFAULT_SETTINGS: Settings = {
  timezone: "America/New_York",
  bookingPageTitle: "Book a Meeting",
  bookingPageDescription: "Select a time that works for you.",
  defaultEventDuration: 30,
};

async function uEmail(event: H3Event): Promise<string> {
  const session = await getSession(event);
  if (!session?.email) {
    const { createError } = await import("h3");
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  }
  return session.email;
}

export const getSettings = defineEventHandler(async (event: H3Event) => {
  try {
    const email = await uEmail(event);
    const settings =
      (await getUserSetting(email, "calendar-settings")) || DEFAULT_SETTINGS;
    return settings;
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});

export const updateSettings = defineEventHandler(async (event: H3Event) => {
  try {
    const email = await uEmail(event);
    const settings: Settings = await readBody(event);
    const settingsRecord = settings as unknown as Record<string, unknown>;
    await putUserSetting(email, "calendar-settings", settingsRecord);
    // Also write to global key so the public booking/settings page can read it
    await putSetting("calendar-settings", settingsRecord);
    return settings;
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});
