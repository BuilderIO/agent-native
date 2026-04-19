import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { listSchedules } from "../server/schedules-repo.js";
import { currentUserEmailOrNull } from "./_helpers.js";

export default defineAction({
  description:
    "List availability schedules visible to the current user — owned, shared, or matching org visibility",
  schema: z.object({}),
  run: async () => {
    if (!currentUserEmailOrNull()) return { schedules: [] };
    return {
      schedules: await listSchedules({ useAccessFilter: true }),
    };
  },
});
