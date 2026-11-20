import { defineAction } from "@agent-native/core/action";
import {
  navigationIntentSchema,
  writeAppStateForCurrentTab,
} from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description:
    "Navigate the Brain UI to a view, source, capture, knowledge item, or proposal.",
  schema: z.object({
    view: z
      .enum([
        "intelligence",
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
    intelligenceTab: z
      .enum(["actions", "brief", "entities", "recipes", "memory"])
      .optional(),
    intelligenceId: z.string().optional(),
    owner: z.string().optional(),
    period: z.enum(["daily", "weekly"]).optional(),
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
    intent: navigationIntentSchema,
  }),
  http: false,
  mcpTool: "search",
  run: async (args) => {
    const { intent: _intent, ...nav } = args;
    await writeAppStateForCurrentTab("navigate", { ...nav, ts: Date.now() });
    return { navigate: nav };
  },
});
