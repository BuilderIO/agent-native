import { processJobs } from "../tasks/jobs/process.js";
import { processAutomations } from "../lib/automation-engine.js";

const INTERVAL_MS = 60_000; // 1 minute

export default () => {
  // Run job processing (snooze, scheduled-send) and automations every minute
  setInterval(async () => {
    try {
      await processJobs();
    } catch (err) {
      console.error("[mail-jobs] processJobs failed:", err);
    }
    try {
      await processAutomations();
    } catch (err) {
      console.error("[mail-jobs] processAutomations failed:", err);
    }
  }, INTERVAL_MS);
};
