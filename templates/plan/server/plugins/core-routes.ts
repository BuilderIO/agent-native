import { createCoreRoutesPlugin } from "@agent-native/core/server";

import { resolvePlanAnonymousOwner } from "../lib/public-plans.js";

export default createCoreRoutesPlugin({
  anonymousOwner: resolvePlanAnonymousOwner,
  mcpConnectServerName: "plan",
  envKeys: [
    { key: "DATABASE_URL", label: "Database URL", required: false },
    {
      key: "DATABASE_AUTH_TOKEN",
      label: "Database Auth Token",
      required: false,
    },
  ],
});
