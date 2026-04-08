import { defineAction } from "@agent-native/core";
import {
  writeAppState,
  deleteAppState,
} from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Force the UI to refresh all data from Greenhouse. Call after mutations.",
  http: false,
  run: async () => {
    await writeAppState("refresh-trigger", { ts: Date.now() });
    await deleteAppState("refresh-trigger");
    return "UI data refresh triggered.";
  },
});
