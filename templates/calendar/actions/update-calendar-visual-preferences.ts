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
    "Update the Calendar app's local visual preferences. Use this for UI-only display changes such as color-coding meetings by type or choosing display colors for connected calendars. This does not call Google Calendar and does not use Google Calendar colorId values.",
  schema: z
    .object({
      colorMode: z
        .enum(["multi", "single"])
        .optional()
        .describe(
          "multi colors Google events by local meeting type; single uses connected-calendar display colors for the user's Google events",
        ),
      singleColor: hexColor
        .optional()
        .describe("Fallback hex display color to use when colorMode is single"),
      accountEmail: z
        .string()
        .email()
        .optional()
        .describe("Connected Google Calendar account email to color"),
      accountColor: hexColor
        .optional()
        .describe("Hex display color for the connected accountEmail"),
      accountColors: z
        .record(z.string(), hexColor)
        .optional()
        .describe(
          "Replacement map of connected Google Calendar account email to hex color. Pass an empty object to clear account color overrides.",
        ),
      hideWeekends: z
        .boolean()
        .optional()
        .describe("Whether the calendar UI hides Saturday and Sunday"),
    })
    .refine((args) => !args.accountEmail === !args.accountColor, {
      message: "accountEmail and accountColor must be provided together",
      path: ["accountColor"],
    }),
  run: async (args) => {
    const current = normalizeCalendarViewPreferences(
      (await readAppState(CALENDAR_VIEW_PREFERENCES_KEY)) as any,
    );
    const colorMode =
      args.colorMode ??
      (args.singleColor || args.accountColor || args.accountColors
        ? "single"
        : undefined);
    const accountColors = {
      ...(args.accountColors ?? current.accountColors),
      ...(args.accountEmail && args.accountColor
        ? { [args.accountEmail]: args.accountColor }
        : {}),
    };
    const next = normalizeCalendarViewPreferences({
      ...current,
      ...args,
      ...(colorMode ? { colorMode } : {}),
      accountColors,
    });

    await writeAppState(
      CALENDAR_VIEW_PREFERENCES_KEY,
      next as unknown as Record<string, unknown>,
    );

    return {
      success: true,
      preferences: next,
      note: "Updated local Calendar UI display preferences only; Google Calendar events were not modified.",
    };
  },
});
