import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { listSchedules } from "../server/schedules-repo.js";
import { currentUserEmail } from "./_helpers.js";

export default defineAction({
  description: "List the current user's availability schedules",
  schema: z.object({}),
  run: async () => ({
    schedules: await listSchedules(currentUserEmail()),
  }),
});
