import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { createSchedule } from "../server/schedules-repo.js";
import { currentUserEmail, currentOrgId } from "./_helpers.js";

export default defineAction({
  description: "Create a new availability schedule",
  schema: z.object({
    name: z.string(),
    timezone: z.string().default("UTC"),
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
  }),
  run: async (args) => ({
    schedule: await createSchedule({
      ownerEmail: currentUserEmail(),
      orgId: currentOrgId(),
      name: args.name,
      timezone: args.timezone,
      isDefault: args.isDefault,
      weeklyAvailability: args.weeklyAvailability as any,
    }),
  }),
});
