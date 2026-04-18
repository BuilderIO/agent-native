import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { upsertDateOverride } from "../server/schedules-repo.js";

export default defineAction({
  description:
    "Add or replace a date-specific override on a schedule (empty intervals = fully blocked)",
  schema: z.object({
    scheduleId: z.string(),
    date: z.string().describe("YYYY-MM-DD"),
    intervals: z.array(
      z.object({ startTime: z.string(), endTime: z.string() }),
    ),
  }),
  run: async (args) => {
    await upsertDateOverride(
      args.scheduleId,
      args.date,
      args.intervals as { startTime: string; endTime: string }[],
    );
    return { ok: true };
  },
});
