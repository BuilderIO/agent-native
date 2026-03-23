import { createFileSyncPlugin } from "@agent-native/core/server";
import { processJobs } from "../tasks/jobs/process.js";

const basePlugin = createFileSyncPlugin();

export default async (nitroApp: any) => {
  await basePlugin(nitroApp);

  // Process scheduled jobs every minute (snooze + send-later)
  setInterval(() => {
    processJobs().catch((err: unknown) =>
      console.error("[jobs] Error processing jobs:", err),
    );
  }, 60_000);
};
