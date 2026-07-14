import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  publicPaths: [
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
  marketing: {
    appName: "Agent-Native Analytics",
    tagline:
      "Your AI agent queries your data sources, builds dashboards, and answers business questions alongside you.",
    features: [
      "Ask any question and get answers from BigQuery, HubSpot, Jira, and more",
      "Agent-built dashboards that pull live data from all your sources",
      "Saved analyses the agent can re-run on demand with fresh numbers",
    ],
  },
});
