import { z } from "zod";

import { defineAction } from "../../action.js";
import { getBetterAuthInternalAdapter } from "../../server/better-auth-instance.js";

export interface AuthMethods {
  hasPassword: boolean;
}

export default defineAction({
  description: "Get the signed-in user's available authentication methods.",
  schema: z.object({}),
  http: { method: "GET" },
  agentTool: false,
  toolCallable: false,
  run: async (_args, ctx): Promise<AuthMethods> => {
    if (!ctx?.userEmail || !ctx.requestHeaders) {
      throw new Error("Not authenticated.");
    }

    const adapter = await getBetterAuthInternalAdapter();
    if (!adapter) {
      throw new Error("Better Auth internal adapter is unavailable.");
    }
    const existing = await adapter.findUserByEmail(ctx.userEmail, {
      includeAccounts: true,
    });

    return {
      hasPassword:
        existing?.accounts.some(
          (account) => account.providerId === "credential",
        ) ?? false,
    };
  },
});
