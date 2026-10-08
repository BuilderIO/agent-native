import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { previewSecretRemoval } from "../usage.js";

export default defineAction({
  description:
    "Preview what stops or switches, per app and feature, if a saved key is removed: models leaving the picker, the default model's fallback, and services that use the key. Returns effects, who is affected, a shared key that takes over, the key's owner page when it is managed elsewhere, and other workspace apps that read the same saved keys. Call before deleting a key or removing a provider, and tell the user the effects. Never returns a key value.",
  schema: z.object({
    key: z
      .string()
      .min(1)
      .describe('Secret name, e.g. "OPENAI_API_KEY" or an ad-hoc key name.'),
    scope: z
      .enum(["user", "workspace", "org"])
      .optional()
      .describe(
        "Stored row to remove. Defaults to the key's registered scope, or user for ad-hoc keys.",
      ),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args, ctx) => {
    if (!ctx?.userEmail) fail("Not authenticated.", { statusCode: 401 });
    return previewSecretRemoval({
      key: args.key,
      ...(args.scope ? { scope: args.scope } : {}),
      ...(ctx.appId ? { appId: ctx.appId } : {}),
    });
  },
});
