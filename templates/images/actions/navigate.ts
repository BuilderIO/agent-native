import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description:
    "Navigate the Images UI. Views: libraries, library, image, audit, settings. Use libraryId or assetId where appropriate.",
  schema: z.object({
    view: z
      .enum(["libraries", "library", "image", "audit", "settings"])
      .optional(),
    libraryId: z.string().optional(),
    assetId: z.string().optional(),
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
