import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";

export default defineAction({
  description: "Trigger the UI to refresh data",
  http: false,
  run: async () => {
    await writeAppState("refresh-trigger", { timestamp: Date.now() });
    return "Refreshed. The UI will update shortly.";
  },
});
