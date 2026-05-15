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
        "sources",
        "source",
        "capture",
        "knowledge",
        "review",
        "proposals",
        "settings",
      ])
      .default("home"),
    sourceId: z.string().optional(),
    captureId: z.string().optional(),
    knowledgeId: z.string().optional(),
    proposalId: z.string().optional(),
    query: z.string().optional(),
  }),
  http: false,
  run: async (args) => {
    await writeAppState("navigate", { ...args, ts: Date.now() });
    return { navigate: args };
  },
});
