import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description:
    "Navigate the Assets UI. Views: create, libraries, library, asset, generation-session, generation-run, extensions, audit, settings. Use libraryId, assetId, sessionId, runId, or extensionId where appropriate.",
  schema: z.object({
    view: z
      .enum([
        "create",
        "libraries",
        "library",
        "asset",
        "image",
        "generation-session",
        "generation-run",
        "extensions",
        "audit",
        "settings",
      ])
      .optional(),
    libraryId: z.string().optional(),
    assetId: z.string().optional(),
    sessionId: z.string().optional(),
    runId: z.string().optional(),
    presetId: z.string().optional(),
    activeTab: z
      .enum(["references", "generated", "runs", "settings"])
      .optional(),
    extensionId: z.string().optional(),
    path: z.string().optional(),
  }),
  http: false,
  run: async (args) => {
    if (!args.view && !args.path) {
      return "Error: view or path is required.";
    }
    await writeAppState("navigate", args);
    return { navigating: true, ...args };
  },
});
