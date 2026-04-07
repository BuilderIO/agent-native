import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "@agent-native/core/vite";

export default defineConfig({
  nitro: {
    experimental: {
      tasks: true,
    },
    tasks: {
      "mail-jobs:process": {
        handler: "./tasks/process-mail-jobs.ts",
        description: "Process due mail snooze and scheduled-send jobs",
      },
      "automations:process": {
        handler: "./tasks/process-automations.ts",
        description: "Process automation rules against new inbox emails",
      },
    },
    scheduledTasks: {
      "* * * * *": ["mail-jobs:process", "automations:process"],
    },
  },
  plugins: [reactRouter()],
});
