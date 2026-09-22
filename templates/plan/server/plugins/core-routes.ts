import { createCoreRoutesPlugin } from "@agent-native/core/server";

import { resolvePlanAnonymousOwner } from "../lib/public-plans.js";

export default createCoreRoutesPlugin({
  googleOAuthManagedConnection: "not_applicable",
  anonymousOwner: resolvePlanAnonymousOwner,
  // Plan's published MCP server id is the bare `plan`, not the derived
  // `agent-native-plan`: `.agents/plugins/agent-native-visual-plans/.mcp.json`
  // ships it, and the CLI's config writers key existing client entries by it.
  // Dropping this override would write a second entry on the next connect
  // instead of updating the one already in a user's config.
  mcp: { serverName: "plan" },
  envKeys: [{ key: "DATABASE_URL", label: "Database URL", required: false }],
});
