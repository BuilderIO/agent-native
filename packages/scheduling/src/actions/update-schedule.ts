import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { assertAccess } from "@agent-native/core/sharing";
import { updateSchedule } from "../server/schedules-repo.js";

export default defineAction({
  description:
    "Update a schedule's name, timezone, weekly availability, or date overrides",
  schema: z.object({
    id: z.string(),
    name: z.string().optional(),
    timezone: z.string().optional(),
    isDefault: z.boolean().optional(),
    weeklyAvailability: z
      .array(
        z.object({
          day: z.number().min(0).max(6),
          intervals: z.array(
            z.object({
              startTime: z.string(),
              endTime: z.string(),
            }),
          ),
        }),
      )
      .optional(),
    dateOverrides: z
      .array(
        z.object({
          date: z.string(),
          intervals: z.array(
            z.object({
              startTime: z.string(),
              endTime: z.string(),
            }),
          ),
        }),
      )
      .optional(),
  }),
  run: async (args) => {
    await assertAccess("schedule", args.id, "editor");
    return {
      schedule: await updateSchedule(args.id, {
        name: args.name,
        timezone: args.timezone,
        isDefault: args.isDefault,
        weeklyAvailability: args.weeklyAvailability as any,
        dateOverrides: args.dateOverrides as any,
      }),
    };
  },
});
