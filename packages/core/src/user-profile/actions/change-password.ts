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
  description: "Change the password for the signed-in user's account.",
  schema: z.object({
    currentPassword: passwordSchema,
    newPassword: passwordSchema,
  }),
  agentTool: false,
  toolCallable: false,
  run: async (
    { currentPassword, newPassword },
    ctx,
  ): Promise<{ status: boolean }> => {
    if (!ctx?.userEmail || !ctx.requestHeaders) {
      throw new Error("Not authenticated.");
    }

    const auth = await getBetterAuth();
    return (
      auth.api as unknown as {
        changePassword: (options: {
          body: { currentPassword: string; newPassword: string };
          headers: Headers;
        }) => Promise<{ status: boolean }>;
      }
    ).changePassword({
      body: { currentPassword, newPassword },
      headers: ctx.requestHeaders,
    });
  },
});
