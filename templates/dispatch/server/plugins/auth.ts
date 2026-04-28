import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  marketing: {
    appName: "Agent-Native Dispatch",
    tagline:
      "Your AI agent manages secrets, orchestrates other agents, and routes messages across your workspace.",
    features: [
      "Centralized vault for secrets with granular per-app grants",
      "Cross-agent orchestration and delegation to specialist apps",
      "Slack and Telegram routing with approval workflows",
    ],
  },
});
