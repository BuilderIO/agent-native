import { z } from "zod";

import { defineAction } from "../../action.js";
import { getBetterAuth } from "../../server/better-auth-instance.js";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "../../shared/password-policy.js";

const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH)
  .max(PASSWORD_MAX_LENGTH);

export default defineAction({
  description: "Add a password to the signed-in user's account.",
  schema: z.object({
    newPassword: passwordSchema,
  }),
  agentTool: false,
  toolCallable: false,
  run: async ({ newPassword }, ctx): Promise<{ status: boolean }> => {
    if (!ctx?.userEmail || !ctx.requestHeaders) {
      throw new Error("Not authenticated.");
    }

    const auth = await getBetterAuth();
    return (
      auth.api as unknown as {
        setPassword: (options: {
          body: { newPassword: string };
          headers: Headers;
        }) => Promise<{ status: boolean }>;
      }
    ).setPassword({
      body: { newPassword },
      headers: ctx.requestHeaders,
    });
  },
});
