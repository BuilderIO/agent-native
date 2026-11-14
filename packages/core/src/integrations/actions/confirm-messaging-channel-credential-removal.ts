import { z } from "zod";

import { defineAction } from "../../action.js";
import { confirmMessagingChannelCredentialRemoval } from "../channel-settings.js";

export default defineAction({
  description:
    "After the owner confirms in Settings, verify the selected channel credentials have not changed and mint exact, short-lived removal confirmations.",
  schema: z.object({
    platform: z.string().min(1).max(64),
    candidates: z
      .array(
        z.object({
          key: z.string().min(1),
          candidate: z.string().min(1),
        }),
      )
      .min(1)
      .max(32),
  }),
  uiOnly: true,
  agentTool: false,
  mcpTool: false,
  toolCallable: false,
  authorize: (_args, ctx) => ctx?.caller === "frontend",
  persistInBrowser: false,
  run: async ({ platform, candidates }, ctx) =>
    confirmMessagingChannelCredentialRemoval(ctx, platform, candidates),
});
