import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { readDashboardForPlacement } from "../server/lib/dashboard-annotation-reads.js";
import { keyDatePlacement } from "../server/lib/dashboard-annotation-summary.js";
import {
  requireKeyDateScope,
  saveKeyDate,
} from "../server/lib/key-dates-store.js";

export default defineAction({
  description:
    'Add a key date to a set, or edit one by id; an edit keeps what it omits. Name the set with setId, or with setName, which finds the set or creates it. A date draws as a marker on every time chart of every dashboard that shows its set. Give time and timeZone when the moment matters, for example a launch at "00:01" "America/Los_Angeles"; dates on the same day share one marker. Pass dashboardId for the dashboard on screen: then `dashboard` in the result says whether it shows the set, with a `hint` when no chart can draw the date.',
  schema: z.object({
    id: z
      .string()
      .min(1)
      .optional()
      .describe("Id of the key date to edit; omit to add one"),
    setId: z.string().min(1).optional().describe("Id of the set"),
    setName: z
      .string()
      .min(1)
      .max(80)
      .optional()
      .describe("Set name, used when setId is omitted; created if missing"),
    date: z.string().describe('Day of the key date, "YYYY-MM-DD"'),
    time: z
      .string()
      .nullable()
      .optional()
      .describe('"HH:MM" (24-hour) in timeZone; null clears both'),
    timeZone: z
      .string()
      .nullable()
      .optional()
      .describe(
        'IANA zone, for example "America/New_York"; UTC if none, null clears. Only with time.',
      ),
    label: z
      .string()
      .min(1)
      .max(120)
      .describe('Short label shown on charts, for example "Product Hunt live"'),
    dashboardId: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Dashboard to check the date against, usually the one on screen; not stored",
      ),
    expectedUpdatedAt: z
      .string()
      .optional()
      .describe(
        "The date's updatedAt from list-key-dates when the edit was made; refuses the edit if it changed since",
      ),
  }),
  run: async ({ dashboardId, ...input }) => {
    const scope = requireKeyDateScope();
    const check = dashboardId
      ? await readDashboardForPlacement(dashboardId, scope)
      : undefined;
    const keyDate = await saveKeyDate(scope, input);
    if (!dashboardId || !check) return keyDate;
    return {
      ...keyDate,
      dashboard:
        "config" in check
          ? keyDatePlacement(keyDate.setId, dashboardId, check.config)
          : { dashboardId, hint: check.unavailable },
    };
  },
});
