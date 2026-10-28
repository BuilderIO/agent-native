import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description:
    "Ask the UI to reread the local inbox store after a change the framework cannot observe. This only refreshes the displayed data; it does not contact Gmail. Use sync-inbox to advance Gmail synchronization in bounded steps.",
  schema: z.object({}),
  http: false,
  run: async () => {
    await writeAppState("refresh-signal", { ts: Date.now() });
    return "Triggered UI refresh";
  },
});
