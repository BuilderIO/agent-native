import { readBody, getSession } from "@agent-native/core/server";
import {
  getSetting,
  getUserSetting,
  putUserSetting,
  putSetting,
} from "@agent-native/core/settings";
import { defineEventHandler, setResponseStatus, type H3Event } from "h3";

import { normalizeCalendarSettings } from "../../shared/settings.js";

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
    return normalizeCalendarSettings(
      await getUserSetting(email, "calendar-settings"),
    );
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});

export const getPublicSettings = defineEventHandler(async (_event: H3Event) => {
  return normalizeCalendarSettings(await getSetting("calendar-settings"));
});

export const updateSettings = defineEventHandler(async (event: H3Event) => {
  try {
    const email = await uEmail(event);
    const body = await readBody<unknown>(event);
    const settings = normalizeCalendarSettings({
      ...normalizeCalendarSettings(
        await getUserSetting(email, "calendar-settings"),
      ),
      ...(body && typeof body === "object" ? body : {}),
    });
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
