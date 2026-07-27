import { defineAction } from "@agent-native/core";
import { queryScreenMemoryForAgent } from "@agent-native/core/mcp-client";
import { z } from "zod";

export default defineAction({
  description:
    "Search bounded local Clips Screen Memory evidence from this machine. Returns typed app-context, OCR, or transcript excerpts only when present in local files, plus coverage, gaps, segment references, jump targets, and truncation; never media bytes or images. Use get-screen-memory-status first if availability is unclear.",
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
      .describe("Maximum number of bounded local evidence items to return"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => queryScreenMemoryForAgent(args),
});
