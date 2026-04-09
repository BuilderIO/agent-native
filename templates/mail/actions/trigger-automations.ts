import { defineAction } from "@agent-native/core";

export default defineAction({
  description:
    "Trigger automation processing to run now against new inbox emails. Automations normally run every minute on a cron, but this forces immediate processing.",
  http: false,
  run: async () => {
    const { triggerAutomationsDebounced } =
      await import("../server/lib/automation-engine.js");

    const result = await triggerAutomationsDebounced();
    if (result.triggered) {
      return "Automation processing triggered. Results will be applied shortly.";
    }
    return `Automation processing skipped: ${result.reason}. Try again in 30 seconds.`;
  },
});
