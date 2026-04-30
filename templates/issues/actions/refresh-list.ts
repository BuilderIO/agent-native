import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { writeAppState } from "@agent-native/core/application-state";

export default defineAction({
  description: "Trigger the UI to refresh data",
  schema: z.object({}),
  http: false,
  run: async () => {
    await writeAppState("refresh-trigger", { timestamp: Date.now() });
    return "Refreshed. The UI will update shortly.";
  },
});
