import { defineAction } from "@agent-native/core";
import { readScreenMemoryStatus } from "@agent-native/core/mcp-client";
import { z } from "zod";

export default defineAction({
  description:
    "Check local Clips Screen Memory status for this machine: enabled/paused state, local storage files, and capture recency. Screen Memory is disabled by default and local-only.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => readScreenMemoryStatus(),
});
