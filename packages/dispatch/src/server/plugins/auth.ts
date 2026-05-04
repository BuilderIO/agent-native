import { createAuthPlugin } from "@agent-native/core/server";
import { getDispatchConfig } from "../index.js";

const DEFAULT_MARKETING = {
  appName: "Agent-Native Dispatch",
  tagline:
    "Your AI agent manages secrets, orchestrates other agents, and routes messages across your workspace.",
  features: [
    "Centralized vault for secrets with granular per-app grants",
    "Cross-agent orchestration and delegation to specialist apps",
    "Slack and Telegram routing with approval workflows",
  ],
} as const;

/**
 * Defer config + plugin construction until the Nitro plugin actually fires.
 * This way `setupDispatch(config)` can run after plugin module-load order
 * (Nitro doesn't guarantee load order across plugin files) and still feed
 * `googleOnly` / `marketing` into `createAuthPlugin`.
 */
const dispatchAuthPlugin = async (nitroApp: any) => {
  const { auth: authConfig = {} } = getDispatchConfig();
  const googleOnly = authConfig.googleOnly ?? false;
  const marketing =
    (authConfig.marketing as Record<string, unknown> | undefined) ??
    DEFAULT_MARKETING;
  const plugin = createAuthPlugin({
    googleOnly,
    marketing: marketing as any,
  });
  return plugin(nitroApp);
};

export default dispatchAuthPlugin;
