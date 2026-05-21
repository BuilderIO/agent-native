import { defineAction } from "@agent-native/core";
import { readAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description: "See the current Agent-Native Code UI navigation state.",
  schema: z.object({}),
  http: false,
  run: async () => {
    const navigation = await readAppState("navigation");
    return navigation
      ? JSON.stringify({ navigation }, null, 2)
      : "No Agent-Native Code screen state is available.";
  },
});
