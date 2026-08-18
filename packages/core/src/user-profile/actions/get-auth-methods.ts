import { z } from "zod";

import { defineAction } from "../../action.js";
import { getBetterAuth } from "../../server/better-auth-instance.js";

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

    const auth = await getBetterAuth();
    const accounts = await (
      auth.api as unknown as {
        listUserAccounts: (options: {
          headers: Headers;
        }) => Promise<Array<{ providerId: string }>>;
      }
    ).listUserAccounts({
      headers: ctx.requestHeaders,
    });

    return {
      hasPassword: accounts.some(
        (account) => account.providerId === "credential",
      ),
    };
  },
});
