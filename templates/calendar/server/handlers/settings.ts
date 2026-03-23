import {
  defineEventHandler,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";
import type { Settings } from "../../shared/api.js";
import { getSetting, putSetting } from "@agent-native/core/settings";

const DEFAULT_SETTINGS: Settings = {
  timezone: "America/New_York",
  bookingPageTitle: "Book a Meeting",
  bookingPageDescription: "Select a time that works for you.",
  defaultEventDuration: 30,
};

export const getSettings = defineEventHandler(async (_event: H3Event) => {
  try {
    const settings =
      (await getSetting("calendar-settings")) || DEFAULT_SETTINGS;
    return settings;
  } catch (error: any) {
    setResponseStatus(_event, 500);
    return { error: error.message };
  }
});

export const updateSettings = defineEventHandler(async (event: H3Event) => {
  try {
    const settings: Settings = await readBody(event);
    await putSetting(
      "calendar-settings",
      settings as unknown as Record<string, unknown>,
    );
    return settings;
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});
