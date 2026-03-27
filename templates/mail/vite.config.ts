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
    },
    scheduledTasks: {
      "* * * * *": "mail-jobs:process",
    },
  },
  plugins: [reactRouter()],
});
