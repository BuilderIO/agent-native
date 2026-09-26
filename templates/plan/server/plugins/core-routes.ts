import { createCoreRoutesPlugin } from "@agent-native/core/server";

import { resolvePlanAnonymousOwner } from "../lib/public-plans.js";

export default createCoreRoutesPlugin({
  googleOAuthManagedConnection: "not_applicable",
  anonymousOwner: resolvePlanAnonymousOwner,
  // signed-in user; scope it to the viewer cookie instead of answering 401.
  anonymousApplicationState: true,
  mcp: { serverName: "plan" },
  envKeys: [{ key: "DATABASE_URL", label: "Database URL", required: false }],
});
