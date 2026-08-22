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

    // Look accounts up by the framework-resolved ctx.userEmail through
    // Better Auth's internal adapter rather than replaying ctx.requestHeaders
    // through auth.api.listUserAccounts: that call re-derives identity from
    // its own cookie-based session lookup, which throws for any caller the
    // framework authenticated without a Better Auth session cookie (an
    // AUTH_DISABLED dev session, a BYOA identity, ...) even though
    // ctx.userEmail is already a trustworthy resolved identity. A missing
    // adapter or user record means there is no Better Auth credential to
    // report, not an unknown failure.
    const adapter = await getBetterAuthInternalAdapter();
    const existing = await adapter?.findUserByEmail(ctx.userEmail, {
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
