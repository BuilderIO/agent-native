import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { getContentHookRuntimeControls } from "./_content-hook-runtime-controls.js";

export default defineAction({
  description:
    "Get global and database-level emergency pause controls for deterministic Content hooks.",
  schema: z.object({ databaseId: z.string().min(1) }),
  http: { method: "GET" },
  run: ({ databaseId }) => getContentHookRuntimeControls(databaseId),
});
