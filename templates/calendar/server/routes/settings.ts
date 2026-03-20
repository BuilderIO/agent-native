import { defineEventHandler, readBody, setResponseStatus, type H3Event } from "h3";
import path from "path";
import type { Settings } from "../../shared/api.js";
import { readJsonFile, writeJsonFile } from "../lib/data-helpers.js";

const SETTINGS_PATH = path.join(process.cwd(), "data", "settings.json");

const DEFAULT_SETTINGS: Settings = {
  timezone: "America/New_York",
  bookingPageTitle: "Book a Meeting",
  bookingPageDescription: "Select a time that works for you.",
  defaultEventDuration: 30,
};

export const getSettings = defineEventHandler((_event: H3Event) => {
  try {
    const settings = readJsonFile<Settings>(SETTINGS_PATH) || DEFAULT_SETTINGS;
    return settings;
  } catch (error: any) {
    setResponseStatus(_event, 500);
    return { error: error.message };
  }
});

export const updateSettings = defineEventHandler(async (event: H3Event) => {
  try {
    const settings: Settings = await readBody(event);
    writeJsonFile(SETTINGS_PATH, settings);
    return settings;
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});
