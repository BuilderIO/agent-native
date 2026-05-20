import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description: "Navigate the Agent-Native Code UI to a path.",
  schema: z.object({
    path: z.string().optional(),
    view: z.string().optional(),
  }),
  http: false,
  run: async (args) => {
    await writeAppState("navigate", {
      path: args.path ?? "/",
      view: args.view ?? "code",
    });
    return "Navigation queued.";
  },
});
