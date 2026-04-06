// @ts-expect-error — nitro/runtime is a virtual module resolved by Nitro at build time
import { defineTask } from "nitro/runtime";
import { processJobs } from "./process.js";

export default defineTask({
  meta: {
    name: "mail-jobs:process",
    description: "Process due mail snooze and scheduled-send jobs",
  },
  async run() {
    return processJobs();
  },
});
