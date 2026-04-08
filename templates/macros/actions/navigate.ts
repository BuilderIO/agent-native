import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";

export default defineAction({
  description: "Navigate the user's UI to a specific view",
  parameters: {
    view: {
      type: "string",
      enum: ["entry", "analytics"],
      description: "View to navigate to",
    },
  },
  http: false,
  run: async (args) => {
    const view = args.view || "entry";
    await writeAppState("navigate", { view });
    return { success: true, navigatedTo: view };
  },
});
