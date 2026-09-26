import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import {
  checkProviderKey,
  PROVIDER_KEY_CHECK_PROVIDERS,
  ProviderKeyCheckRequestError,
} from "../../server/agent-engine-provider-models-route.js";

export default defineAction({
  description:
    'Check a model provider API key by asking the provider which models it reaches. Returns { ok, models } or { ok: false, code, reason } where code is "rejected", "wrong-provider" (the key has another provider\'s prefix), "missing-key", "invalid-endpoint", "unreachable", or "provider-error". Call it before saving a key the user gives you, and tell them the reason when it fails. Omit key to re-check the saved key against its saved endpoint; a saved key that now works stops showing as rejected. Never returns the key.',
  schema: z.object({
    provider: z
      .enum(PROVIDER_KEY_CHECK_PROVIDERS as [string, ...string[]])
      .describe("Provider id, e.g. anthropic, openai, openrouter, google."),
    key: z
      .string()
      .optional()
      .describe("The key to check. Omit to check the saved key."),
    baseUrl: z
      .string()
      .optional()
      .describe(
        "OpenAI-compatible gateway or Ollama endpoint to check a pasted key against. Requires key, except for Ollama. Omit to use the saved endpoint.",
      ),
    scope: z
      .enum(["user", "org"])
      .optional()
      .describe(
        "Which saved key to check when key is omitted: the personal or the organization row. org is for owners and admins only. Defaults to the key in effect.",
      ),
  }),
  readOnly: true,
  grounding: true,
  run: async (args, ctx) => {
    if (!ctx?.userEmail) fail("Not authenticated.", { statusCode: 401 });
    try {
      return await checkProviderKey({
        provider:
          args.provider as (typeof PROVIDER_KEY_CHECK_PROVIDERS)[number],
        ...(args.key?.trim() ? { key: args.key.trim() } : {}),
        ...(args.baseUrl?.trim() ? { baseUrl: args.baseUrl.trim() } : {}),
        ...(args.scope ? { scope: args.scope } : {}),
      });
    } catch (err) {
      if (err instanceof ProviderKeyCheckRequestError) {
        fail(err.message, { statusCode: err.statusCode });
      }
      throw err;
    }
  },
});
