import { defineAction } from "@agent-native/core/action";
import { writeAppStateForCurrentTab } from "@agent-native/core/application-state";
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
    projectId: z.string().optional(),
    type: z.enum(["knowledge", "capture", "source", "all"]).optional(),
    provider: z.string().optional(),
    status: z.string().optional(),
    issue: z.enum(["all", "failed", "stale", "retryable"]).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    settingsSection: z
      .enum([
        "general",
        "identity",
        "behavior",
        "publishing",
        "safety",
        "privacy",
      ])
      .optional()
      .describe(
        "With view settings, the Brain › General tab to open: general, identity, behavior, publishing, safety, or privacy.",
      ),
  }),
  http: false,
  run: async (args) => {
    await writeAppStateForCurrentTab("navigate", { ...args, ts: Date.now() });
    return { navigate: args };
  },
});
