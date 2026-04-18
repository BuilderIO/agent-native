import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { removeDateOverride } from "../server/schedules-repo.js";

export default defineAction({
  description: "Remove a date-specific override from a schedule",
  schema: z.object({
    scheduleId: z.string(),
    date: z.string(),
  }),
  run: async (args) => {
    await removeDateOverride(args.scheduleId, args.date);
    return { ok: true };
  },
});
