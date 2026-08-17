import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { getAgentThreadDebug } from "../server/lib/thread-debug-store.js";

export default defineAction({
  description:
    "Get a full read-only debug snapshot by chat thread ID or copied request/run ID, including persisted messages, raw thread_data, run events, traces, feedback, evals, and checkpoints when present.",
  schema: z
    .object({
      sourceId: z
        .string()
        .default("current")
        .describe("Thread debug source id from list-agent-thread-sources."),
      threadId: z
        .string()
        .min(1)
        .optional()
        .describe("Agent chat thread ID to inspect."),
      runId: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Copied Agent Native request/run ID, usually shown as run-..., to resolve to its owning chat thread.",
        ),
      ownerEmail: z
        .string()
        .optional()
        .describe("Optional owner email scope for admin cross-user lookups."),
      maxRuns: z.coerce.number().int().min(1).max(50).default(20),
      maxEvents: z.coerce.number().int().min(1).max(2000).default(600),
      maxTraceSpans: z.coerce.number().int().min(1).max(2000).default(500),
    })
    .refine((input) => Boolean(input.threadId || input.runId), {
      message: "Provide either threadId or runId.",
    }),
  http: { method: "GET" },
  readOnly: true,
  run: async (input) => getAgentThreadDebug(input),
});
