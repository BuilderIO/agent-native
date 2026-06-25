import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { setDefaultSchedule } from "../server/schedules-repo.js";
import { currentUserEmail } from "./_helpers.js";

export default defineAction({
  description: "Mark a schedule as the user's default",
  schema: z.object({ id: z.string() }),
  run: async (args) => {
    await assertAccess("schedule", args.id, "editor");
    await setDefaultSchedule(currentUserEmail(), args.id);
    return { ok: true };
  },
});
