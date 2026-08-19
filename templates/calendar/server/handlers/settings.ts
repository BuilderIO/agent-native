import { readBody, getSession } from "@agent-native/core/server";
import { defineEventHandler, setResponseStatus, type H3Event } from "h3";

import {
  readCalendarSettings,
  readPublicCalendarSettings,
  saveCalendarSettings,
} from "../lib/calendar-settings.js";

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
    return await readCalendarSettings(await uEmail(event));
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});

export const getPublicSettings = defineEventHandler(async (_event: H3Event) => {
  return readPublicCalendarSettings();
});

export const updateSettings = defineEventHandler(async (event: H3Event) => {
  try {
    const email = await uEmail(event);
    return await saveCalendarSettings(email, await readBody<unknown>(event));
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});
