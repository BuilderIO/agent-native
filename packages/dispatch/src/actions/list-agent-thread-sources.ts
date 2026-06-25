import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { listThreadDebugSources } from "../server/lib/thread-debug-store.js";

export default defineAction({
  description:
    "List read-only agent thread debug database sources available to Dispatch. Admins can use configured app-prefixed prod DB sources.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => listThreadDebugSources(),
});
