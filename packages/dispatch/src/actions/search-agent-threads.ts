import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { searchAgentThreads } from "../server/lib/thread-debug-store.js";

export default defineAction({
  description:
    "Search agent chat threads by title, preview, full persisted thread content, or an exact request/run ID. Approved read-only Thread Debug operators and organization admins may inspect organization-owned threads across connected sources; other callers are limited to their own current Dispatch threads.",
  schema: z.object({
    sourceId: z
      .string()
      .default("current")
      .describe("Thread debug source id from list-agent-thread-sources."),
    query: z
      .string()
      .optional()
      .describe(
        "Full-text search term matched against title, preview, and thread data.",
      ),
    ownerEmail: z
      .string()
      .optional()
      .describe(
        "Optional owner email filter inside the caller's permitted scope. Approved Thread Debug operators and admins may pass '*' or omit it to search their organization-visible scope.",
      ),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (input) => searchAgentThreads(input),
});
