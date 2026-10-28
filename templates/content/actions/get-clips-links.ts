import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  clipsLinkOrigins,
  resolveClipsAppUrl,
} from "../server/lib/clips-peer.js";

export default defineAction({
  description:
    "Where this Content's Clips app lives: the app URL that opens a Clip, and the app URLs whose /r/, /share/ and /embed/ links the video block's Link tab turns into a Clip block. Both are empty when no Clips app is set up.",
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
    appUrl: resolveClipsAppUrl(),
    linkOrigins: clipsLinkOrigins(),
  }),
});
