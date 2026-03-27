import { defineTask } from "nitropack/runtime";
import { processJobs } from "../server/tasks/jobs/process.js";

export default defineTask({
  meta: {
    name: "mail-jobs:process",
    description: "Process due mail snooze and scheduled-send jobs",
  },
  async run() {
    return processJobs();
  },
});
