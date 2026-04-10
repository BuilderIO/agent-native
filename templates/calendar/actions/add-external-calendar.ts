import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { nanoid } from "nanoid";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
import { fetchICalName } from "../server/lib/ical-fetcher.js";
import type { ExternalCalendar } from "../shared/api.js";

const CALENDAR_COLORS = [
  "#E07C4F",
  "#8B5CF6",
  "#10B981",
  "#F59E0B",
  "#EC4899",
  "#06B6D4",
  "#84CC16",
  "#EF4444",
  "#6366F1",
  "#14B8A6",
];

export default defineAction({
  description:
    "Add an external calendar subscription from an ICS or webcal:// URL",
  schema: z.object({
    url: z
      .string()
      .describe(
        "ICS feed URL (https:// or webcal://) e.g. webcal://app.rippling.com/.../calendar.ics",
      ),
    name: z
      .string()
      .optional()
      .describe("Display name (auto-derived from feed if omitted)"),
    color: z
      .string()
      .optional()
      .describe("Hex color for events from this feed"),
  }),
  run: async (args) => {
    const email = process.env.AGENT_USER_EMAIL || "local@localhost";
    const existing =
      ((await getUserSetting(email, "external-calendars")) as
        | ExternalCalendar[]
        | null) ?? [];

    const usedColors = new Set(existing.map((c) => c.color));
    const autoColor =
      CALENDAR_COLORS.find((c) => !usedColors.has(c)) ??
      CALENDAR_COLORS[existing.length % CALENDAR_COLORS.length];

    const derivedName = args.name ?? (await fetchICalName(args.url));

    const newCalendar: ExternalCalendar = {
      id: nanoid(),
      name: derivedName,
      url: args.url,
      color: args.color ?? autoColor,
    };

    const updated = [...existing, newCalendar];
    await putUserSetting(
      email,
      "external-calendars",
      updated as unknown as Record<string, unknown>,
    );
    return newCalendar;
  },
});
