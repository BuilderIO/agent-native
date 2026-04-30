import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  writeAppState,
  deleteAppState,
} from "@agent-native/core/application-state";

export default defineAction({
  description: "Trigger a UI refresh by writing and deleting a refresh signal.",
  schema: z.object({}),
  http: false,
  run: async () => {
    await writeAppState("refresh-trigger", { ts: Date.now() });
    await deleteAppState("refresh-trigger");
    return "UI refresh triggered.";
  },
});
