import { defineAction } from "@agent-native/core";
import { queryScreenMemoryContext } from "@agent-native/core/mcp-client";
import { z } from "zod";

export default defineAction({
  description:
    "Search recent local Clips Screen Memory context from this machine. Returns bounded OCR/context snippets only; use get-screen-memory-status first if availability is unclear.",
  schema: z.object({
    query: z
      .string()
      .optional()
      .describe("Optional case-insensitive search text"),
    sinceMinutes: z.coerce
      .number()
      .min(0)
      .optional()
      .describe("Only include captures newer than this many minutes"),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .default(10)
      .describe("Maximum number of context snippets to return"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => queryScreenMemoryContext(args),
});
