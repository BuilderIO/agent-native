import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { searchAgentThreads } from "../server/lib/thread-debug-store.js";

export default defineAction({
  description:
    "Search agent chat threads by title, owner email, preview, full persisted thread content, source URL, or an exact thread ID, request/run ID, or scoped object ID (deck, design, clip, document, and other app resources the thread was opened on). Non-admins are limited to their own current Dispatch DB threads.",
  schema: z.object({
    sourceId: z
      .string()
      .default("current")
      .describe("Thread debug source id from list-agent-thread-sources."),
    query: z
      .string()
      .optional()
      .describe(
        "Full-text search term matched against title, owner email, preview, thread data, and source URL; also an exact thread ID, request/run ID, or app object ID such as a deck or design ID.",
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
