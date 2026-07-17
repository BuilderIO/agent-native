import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

import { setContentHookRuntimeControl } from "./_content-hook-runtime-controls.js";

export default defineAction({
  description:
    "Pause or resume deterministic Content hook evaluation and outward effects globally or for one database.",
  schema: z.object({
    databaseId: z.string().min(1),
    scope: z.enum(["global", "database"]),
    evaluatorPaused: z.boolean(),
    effectsPaused: z.boolean(),
  }),
  run: async (args) => {
    const result = await setContentHookRuntimeControl(args);
    await writeAppState("refresh-signal", { ts: Date.now() });
    return result;
  },
});
