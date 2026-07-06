import { defineAction } from "@agent-native/core";
import {
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { z } from "zod";

import {
  CALENDAR_VIEW_PREFERENCES_KEY,
  isValidCalendarColor,
  normalizeCalendarViewPreferences,
} from "../shared/calendar-view-preferences.js";

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex color such as #5B9BD5");

let updateQueue = Promise.resolve();

export default defineAction({
  description:
    "Update the Calendar app's local visual preferences. Use this for UI-only display changes such as color-coding meetings by type or choosing a display color for one or more connected Google accounts. This does not call Google Calendar and does not use Google Calendar colorId values.",
  schema: z
    .object({
      colorMode: z
        .enum(["multi", "single"])
        .optional()
        .describe(
          "Legacy global fallback used only for accounts with no per-account mode set. multi colors Google events by local meeting type; single uses singleColor.",
        ),
      singleColor: hexColor
        .optional()
        .describe(
          "Legacy global fallback hex color, used only for accounts with no per-account color set",
        ),
      accountEmail: z
        .string()
        .email()
        .optional()
        .describe("Connected Google Calendar account email to update"),
      accountColorMode: z
        .enum(["multi", "single"])
        .optional()
        .describe(
          "Color mode for accountEmail: multi colors by local meeting type, single uses accountColor",
        ),
      accountColor: hexColor
        .optional()
        .describe("Hex display color for the connected accountEmail"),
      accountColors: z
        .record(z.string(), hexColor)
        .optional()
        .describe(
          "Map of connected Google Calendar account email to hex color, for setting multiple accounts at once",
        ),
      hideWeekends: z
        .boolean()
        .optional()
        .describe("Whether the calendar UI hides Saturday and Sunday"),
    })
    .refine(
      (args) =>
        !(args.accountColor || args.accountColorMode) || !!args.accountEmail,
      {
        message:
          "accountColor and accountColorMode require accountEmail to be set",
        path: ["accountEmail"],
      },
    ),
  run: async (args) => {
    const runUpdate = async () => {
      const current = normalizeCalendarViewPreferences(
        (await readAppState(CALENDAR_VIEW_PREFERENCES_KEY)) as any,
      );
      const colorMode =
        args.colorMode ?? (args.singleColor ? "single" : undefined);
      const accountColors = {
        ...current.accountColors,
        ...(args.accountColors ?? {}),
        ...(args.accountEmail && args.accountColor
          ? { [args.accountEmail]: args.accountColor }
          : {}),
      };
      const accountColorModes = {
        ...current.accountColorModes,
        ...Object.fromEntries(
          Object.keys(args.accountColors ?? {}).map((email) => [
            email,
            "single" as const,
          ]),
        ),
        ...(args.accountEmail && args.accountColor
          ? { [args.accountEmail]: "single" as const }
          : {}),
        ...(args.accountEmail && args.accountColorMode
          ? { [args.accountEmail]: args.accountColorMode }
          : {}),
      };
      const next = normalizeCalendarViewPreferences({
        ...current,
        hideWeekends: args.hideWeekends ?? current.hideWeekends,
        ...(colorMode ? { colorMode } : {}),
        ...(isValidCalendarColor(args.singleColor)
          ? { singleColor: args.singleColor }
          : {}),
        accountColors,
        accountColorModes,
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
    };

    const result = updateQueue.then(runUpdate, runUpdate);
    updateQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  },
});
