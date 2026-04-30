import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";

export default defineAction({
  description:
    "Trigger automation processing to run now against new inbox emails. Automations normally run every minute on a cron, but this forces immediate processing.",
  http: false,
  run: async () => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      return "Automation processing requires a signed-in user.";
    }

    const { triggerAutomationsDebounced } =
      await import("../server/lib/automation-engine.js");

    const result = await triggerAutomationsDebounced(ownerEmail);
    if (result.triggered) {
      return "Automation processing triggered. Results will be applied shortly.";
    }
    return `Automation processing skipped: ${result.reason}. Try again in 30 seconds.`;
  },
});
