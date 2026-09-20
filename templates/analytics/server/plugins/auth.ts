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
    // Agent-readable context links: fetched with no session cookie, so the
    // gate must not 401 before each handler verifies its scoped token. One
    // by one: a `/api/session-replay` prefix would also expose recordings.
    ANALYTICS_DASHBOARD_AGENT_CONTEXT_ENDPOINT,
    ANALYTICS_ANALYSIS_AGENT_CONTEXT_ENDPOINT,
    SESSION_REPLAY_AGENT_CONTEXT_ENDPOINT,
    SESSION_REPLAY_AGENT_EVENTS_ENDPOINT,
    SESSION_REPLAY_AGENT_DIAGNOSTICS_ENDPOINT,
    "/track",
    "/api/analytics/track",
    "/api/analytics/replay",
    // Public uptime status pages: the SSR route `/status/<slug>` and its
    // matching unauthenticated read action. The action only ever returns the
    // sanitized projection of a PUBLISHED page (see actions/get-public-status-page.ts
    // and server/lib/status-pages.ts `getPublicStatusPage`).
    "/status",
    "/_agent-native/actions/get-public-status-page",
  ],
  // These browser-ingest routes validate their public key and payload at the
  // handler boundary. Allow their preflights even when the deployment-wide
  // CORS allowlist is intentionally empty.
  publicCorsPaths: ["/track", "/api/analytics/track", "/api/analytics/replay"],
  marketing: {
    appName: "Analytics",
    screenshotPath: "/auth-marketing/analytics.webp",
    screenshotWidth: 927,
    screenshotHeight: 818,
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
  // Keep the custom slot marked so runtime discovery cannot mount a second
  // default auth plugin while this worker is registering its internal routes.
  markDefaultPluginProvided(nitroApp, "auth");
  if (isInBackgroundFunctionRuntime()) {
    // Background functions authenticate their signed processor routes locally;
    // Better Auth would perform an unnecessary database initialization here.
    console.info(
      "[auth] Skipping Better Auth setup in durable background runtime",
    );
    return;
  }
  await authPlugin(nitroApp);
};
