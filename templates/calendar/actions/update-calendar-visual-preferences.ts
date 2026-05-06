import { defineAction } from "@agent-native/core";
import {
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { z } from "zod";
import {
  CALENDAR_VIEW_PREFERENCES_KEY,
  normalizeCalendarViewPreferences,
} from "../shared/calendar-view-preferences.js";

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex color such as #5B9BD5");

export default defineAction({
  description:
    "Update the Calendar app's local visual preferences. Use this for UI-only display changes such as color-coding meetings by type or using one display color. This does not call Google Calendar and does not use Google Calendar colorId values.",
  schema: z.object({
    colorMode: z
      .enum(["multi", "single"])
      .optional()
      .describe(
        "multi colors Google events by local meeting type; single uses one local display color for the user's Google events",
      ),
    singleColor: hexColor
      .optional()
      .describe("Hex display color to use when colorMode is single"),
    hideWeekends: z
      .boolean()
      .optional()
      .describe("Whether the calendar UI hides Saturday and Sunday"),
  }),
  run: async (args) => {
    const current = normalizeCalendarViewPreferences(
      (await readAppState(CALENDAR_VIEW_PREFERENCES_KEY)) as any,
    );
    const colorMode = args.colorMode ?? (args.singleColor ? "single" : undefined);
    const next = normalizeCalendarViewPreferences({
      ...current,
      ...args,
      ...(colorMode ? { colorMode } : {}),
    });

    await writeAppState(CALENDAR_VIEW_PREFERENCES_KEY, next);

    return {
      success: true,
      preferences: next,
      note:
        "Updated local Calendar UI display preferences only; Google Calendar events were not modified.",
    };
  },
});
