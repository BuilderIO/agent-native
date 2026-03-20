import { defineNitroConfig } from "nitropack/config";

export default defineNitroConfig({
  compatibilityDate: "2025-01-01",
  experimental: {
    tasks: true,
  },
  scheduledTasks: {
    "*/15 * * * *": ["jobs:process"],
  },
});
