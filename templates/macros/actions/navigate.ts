import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description: "Navigate the user's UI to a specific view",
  schema: z.object({
    view: z
      .enum(["entry", "analytics"])
      .optional()
      .describe("View to navigate to"),
  }),
  http: false,
  run: async (args) => {
    const view = args.view || "entry";
    await writeAppState("navigate", { view });
    return { success: true, navigatedTo: view };
  },
});
