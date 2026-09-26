import { createAuthPlugin } from "@agent-native/core/server";

import { getDispatchConfig } from "../index.js";

const DEFAULT_MARKETING = {
  appName: "Dispatch",
  tagline:
    "Your AI agent manages secrets, orchestrates other agents, and routes messages across your workspace.",
  features: [
    "Centralized vault for secrets with granular per-app grants",
    "Cross-agent orchestration and delegation to specialist apps",
    "Slack and Telegram routing with approval workflows",
  ],
} as const;

const dispatchAuthPlugin = async (nitroApp: any) => {
  const { auth: authConfig = {} } = getDispatchConfig();
  const googleOnly = authConfig.googleOnly ?? false;
  const marketing = authConfig.marketing
    ? { ...DEFAULT_MARKETING, ...authConfig.marketing }
    : DEFAULT_MARKETING;
  const plugin = createAuthPlugin({
    googleOnly,
    marketing: marketing as any,
    workspaceAppPublicPaths: ["/"],
    publicPaths: authConfig.publicPaths,
  });
  return plugin(nitroApp);
};

export default dispatchAuthPlugin;
