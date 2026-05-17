import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  marketing: {
    appName: "Agent-Native Design",
    tagline:
      "Design and prototype by describing what you want. The AI agent turns your ideas into interactive, fully responsive designs in seconds.",
    features: [
      "Create polished prototypes just by describing them",
      "Build and apply design systems to keep everything on-brand",
      "Export your work or share it with a link",
    ],
  },
  // The coding-handoff bundle endpoint is intentionally public so external
  // coding agents (over MCP) can fetch the raw design without a browser
  // cookie. It is not actually open: GET /api/design-handoff/:id is gated by
  // a signed, expiring handoff token bound to the design id (see
  // server/routes/api/design-handoff/[id].get.ts — verifyShortLivedToken).
  // publicPaths uses prefix matching, so this covers
  // /api/design-handoff/<id>?token=... while keeping every other /api/* and
  // /_agent-native/* route behind auth.
  publicPaths: ["/api/design-handoff"],
});
