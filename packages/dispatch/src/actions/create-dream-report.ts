import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { createDreamReport } from "../server/lib/dreams-store.js";

export default defineAction({
  description:
    "Create a Dispatch dream report from existing thread-debug records and produce pending, evidence-backed memory proposals without calling an LLM.",
  schema: z.object({
    sourceId: z
      .string()
      .default("current")
      .describe("Thread debug source id from list-agent-thread-sources."),
    query: z
      .string()
      .optional()
      .describe("Optional search term to focus dream candidate discovery."),
    ownerEmail: z
      .string()
      .optional()
      .describe(
        "Optional owner email filter. Admins may pass '*' or omit to use their admin-visible scope.",
      ),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    title: z.string().optional().describe("Optional title for the dream pass."),
  }),
  run: async (input) => createDreamReport(input),
});
