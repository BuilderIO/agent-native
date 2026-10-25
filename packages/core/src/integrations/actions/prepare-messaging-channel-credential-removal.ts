import { z } from "zod";

import { defineAction } from "../../action.js";
import { prepareMessagingChannelCredentialRemoval } from "../channel-settings.js";

export default defineAction({
  description:
    "Read the current removable credentials for one channel from the signed-in Settings UI. This returns a non-authorizing snapshot used to detect changes before a human confirms removal.",
  schema: z.object({
    platform: z.string().min(1).max(64),
    keys: z.array(z.string().min(1)).min(1).max(32),
  }),
  uiOnly: true,
  agentTool: false,
  mcpTool: false,
  toolCallable: false,
  authorize: (_args, ctx) => ctx?.caller === "frontend",
  readOnly: true,
  run: async ({ platform, keys }, ctx) =>
    prepareMessagingChannelCredentialRemoval(ctx, platform, keys),
});
