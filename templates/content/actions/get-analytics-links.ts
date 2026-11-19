import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  analyticsLinkOrigins,
  resolveAnalyticsAppUrl,
} from "../server/lib/analytics-peer.js";

export default defineAction({
  description:
    "Where this Content's Analytics app lives: the app URL, and the app URLs whose dashboard panel links a paste turns into an Analytics chart. Both are empty when no Analytics app is set up.",
  schema: z.object({}),
  outputSchema: z.object({
    appUrl: z.string().nullable(),
    linkOrigins: z.array(z.string()),
  }),
  http: { method: "GET" },
  readOnly: true,
  requiresAuth: false,
  agentTool: false,
  run: async () => ({
    appUrl: resolveAnalyticsAppUrl(),
    linkOrigins: analyticsLinkOrigins(),
  }),
});
