import {
  createAuthPlugin,
  isInBackgroundFunctionRuntime,
  markDefaultPluginProvided,
} from "@agent-native/core/server";

import {
  ANALYTICS_ANALYSIS_AGENT_CONTEXT_ENDPOINT,
  ANALYTICS_DASHBOARD_AGENT_CONTEXT_ENDPOINT,
} from "../../shared/resource-agent-access.js";
import {
  SESSION_REPLAY_AGENT_CONTEXT_ENDPOINT,
  SESSION_REPLAY_AGENT_DIAGNOSTICS_ENDPOINT,
  SESSION_REPLAY_AGENT_EVENTS_ENDPOINT,
} from "../../shared/session-replay-agent-access.js";

const authPlugin = createAuthPlugin({
  workspaceAppPublicPaths: ["/"],
  publicPaths: [
    // gate must not 401 before each handler verifies its scoped token. One
    ANALYTICS_DASHBOARD_AGENT_CONTEXT_ENDPOINT,
    ANALYTICS_ANALYSIS_AGENT_CONTEXT_ENDPOINT,
    SESSION_REPLAY_AGENT_CONTEXT_ENDPOINT,
    SESSION_REPLAY_AGENT_EVENTS_ENDPOINT,
    SESSION_REPLAY_AGENT_DIAGNOSTICS_ENDPOINT,
    "/track",
    "/api/analytics/track",
    "/api/analytics/replay",
    "/status",
    "/_agent-native/actions/get-public-status-page",
  ],
  publicCorsPaths: ["/track", "/api/analytics/track", "/api/analytics/replay"],
  marketing: {
    appName: "Analytics",
    learnMoreUrl: "https://agent-native.com/apps/analytics",
    tagline:
      "Your AI agent queries your data sources, builds dashboards, and answers business questions alongside you.",
    features: [
      "Ask any question and get answers from BigQuery, HubSpot, Jira, and more",
      "Agent-built dashboards that pull live data from all your sources",
      "Saved analyses the agent can re-run on demand with fresh numbers",
    ],
  },
});

export default async (nitroApp: any): Promise<void> => {
  markDefaultPluginProvided(nitroApp, "auth");
  if (isInBackgroundFunctionRuntime()) {
    console.info(
      "[auth] Skipping Better Auth setup in durable background runtime",
    );
    return;
  }
  await authPlugin(nitroApp);
};
