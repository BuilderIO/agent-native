import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { assertAccess } from "@agent-native/core/sharing";
import { deleteSchedule } from "../server/schedules-repo.js";

export default defineAction({
  description: "Delete a schedule",
  schema: z.object({ id: z.string() }),
  run: async (args) => {
    await assertAccess("schedule", args.id, "admin");
    await deleteSchedule(args.id);
    return { ok: true };
  },
});
