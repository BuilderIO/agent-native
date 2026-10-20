import { createCoreRoutesPlugin } from "@agent-native/core/server";

import { resolvePlanAnonymousOwner } from "../lib/public-plans.js";

export default createCoreRoutesPlugin({
  googleOAuthManagedConnection: "not_applicable",
  anonymousOwner: resolvePlanAnonymousOwner,
  anonymousApplicationState: true,
  mcp: { serverName: "plan" },
  envKeys: [{ key: "DATABASE_URL", label: "Database URL", required: false }],
});
