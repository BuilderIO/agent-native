import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description:
    "Navigate the Brain UI to a view, source, capture, knowledge item, or proposal.",
  schema: z.object({
    view: z
      .enum([
        "home",
        "ask",
        "search",
        "sources",
        "source",
        "capture",
        "knowledge",
        "review",
        "proposals",
        "extensions",
        "ops",
        "settings",
      ])
      .default("home"),
    sourceId: z.string().optional(),
    captureId: z.string().optional(),
    knowledgeId: z.string().optional(),
    proposalId: z.string().optional(),
    extensionId: z.string().optional(),
    query: z.string().optional(),
    type: z.enum(["knowledge", "capture", "source", "all"]).optional(),
    provider: z.string().optional(),
    status: z.string().optional(),
    issue: z.enum(["all", "failed", "stale", "retryable"]).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }),
  http: false,
  run: async (args) => {
    await writeAppState("navigate", { ...args, ts: Date.now() });
    return { navigate: args };
  },
});
