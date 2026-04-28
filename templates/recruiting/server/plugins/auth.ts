import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  marketing: {
    appName: "Agent-Native Recruiting",
    tagline:
      "Your AI agent screens candidates, manages pipelines, and keeps your hiring on track.",
    features: [
      "AI resume analysis and candidate comparison",
      "Pipeline management with automated stage progression",
      "Scorecard tracking and overdue feedback alerts",
    ],
  },
});
