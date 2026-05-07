import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description:
    "Navigate the Images UI. Views: create, libraries, library, image, extensions, audit, settings. Use libraryId, assetId, or extensionId where appropriate.",
  schema: z.object({
    view: z
      .enum([
        "create",
        "libraries",
        "library",
        "image",
        "extensions",
        "audit",
        "settings",
      ])
      .optional(),
    libraryId: z.string().optional(),
    assetId: z.string().optional(),
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
