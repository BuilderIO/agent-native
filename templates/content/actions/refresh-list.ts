import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description:
    "Refresh the document list in the UI by writing a signal to application state.",
  schema: z.object({}),
  http: false,
  run: async () => {
    await writeAppState("refresh-signal", { ts: Date.now() });
    return "Triggered UI refresh";
  },
});
