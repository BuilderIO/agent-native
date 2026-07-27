import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description:
    "Navigate the Assets UI. Views (internal keys, with the surface they open): create, picker (the embedded image Library picker), libraries (the unified Library workspace), library (a single Brand Kit inside Library), preset (a generation preset editor), asset, generation-session, generation-run, extensions, audit, settings. Use threadId to open a specific create/chat thread; use libraryId, presetId, assetId, sessionId, runId, or extensionId where appropriate.",
  schema: z.object({
    view: z
      .enum([
        "create",
        "picker",
        "libraries",
        "library",
        "preset",
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
    threadId: z.string().optional(),
    presetId: z.string().optional(),
    mediaType: z.enum(["image", "video"]).optional(),
    query: z.string().optional(),
    prompt: z.string().optional(),
    aspectRatio: z.string().optional(),
    activeTab: z
      .enum(["references", "generated", "runs", "settings"])
      .optional(),
    extensionId: z.string().optional(),
    path: z.string().optional(),
  }),
  http: false,
  run: async (args) => {
    if (!args.view && !args.path) {
      throw new Error("view or path is required.");
    }
    await writeAppState("navigate", args);
    return { navigating: true, ...args };
  },
});
