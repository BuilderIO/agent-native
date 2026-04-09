import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Refresh the email list displayed in the UI. Triggers the UI to refetch from Gmail. Call this after any backend change (archive, trash, star, mark-read, send, etc.).",
  http: false,
  run: async () => {
    await writeAppState("refresh-signal", { ts: Date.now() });
    return "Triggered UI refresh";
  },
});
