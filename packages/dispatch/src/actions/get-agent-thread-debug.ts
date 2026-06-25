import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { getAgentThreadDebug } from "../server/lib/thread-debug-store.js";

export default defineAction({
  description:
    "Get a full read-only debug snapshot for an agent chat thread, including persisted messages, raw thread_data, run events, traces, feedback, evals, and checkpoints when present.",
  schema: z.object({
    sourceId: z
      .string()
      .default("current")
      .describe("Thread debug source id from list-agent-thread-sources."),
    threadId: z.string().min(1).describe("Agent chat thread id to inspect."),
    ownerEmail: z
      .string()
      .optional()
      .describe("Optional owner email scope for admin cross-user lookups."),
    maxRuns: z.coerce.number().int().min(1).max(50).default(20),
    maxEvents: z.coerce.number().int().min(1).max(2000).default(600),
    maxTraceSpans: z.coerce.number().int().min(1).max(2000).default(500),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (input) => getAgentThreadDebug(input),
});
