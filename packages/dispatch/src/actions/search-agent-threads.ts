import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { searchAgentThreads } from "../server/lib/thread-debug-store.js";

export default defineAction({
  description:
    "Search agent chat threads by title, preview, or full persisted thread content. Non-admins are limited to their own current Dispatch DB threads.",
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
        "Optional owner email filter. Admins may pass '*' or omit to search the admin-visible scope.",
      ),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (input) => searchAgentThreads(input),
});
