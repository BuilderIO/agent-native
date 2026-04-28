import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  marketing: {
    appName: "Scheduling",
    tagline:
      "Your AI agent manages availability, books meetings, and handles rescheduling alongside you.",
    features: [
      "Automatic round-robin and team scheduling across hosts",
      "Smart availability management with conflict detection",
      "Autonomous rescheduling, reminders, and follow-ups",
    ],
  },
});
