import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  designLinkOrigins,
  resolveDesignAppUrl,
} from "../server/lib/design-peer.js";

export default defineAction({
  description:
    "Where this Content's Design app lives: the app URL, and the app URLs whose screen links a paste turns into a pinned Design screen. Both are empty when no Design app is set up.",
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
    appUrl: resolveDesignAppUrl(),
    linkOrigins: designLinkOrigins(),
  }),
});
