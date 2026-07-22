import { z } from "zod";

import { defineAction } from "../../action.js";
import type { UserProfile } from "../shared.js";
import { updateUserProfile } from "../store.js";

export default defineAction({
  description:
    "Update the current user's display name used across Agent-Native apps. Do not change the user's email address with this action.",
  schema: z.object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .describe(
        "The display name to use when referring to the signed-in user.",
      ),
  }),
  run: async ({ name }, ctx): Promise<UserProfile> => {
    if (!ctx?.userEmail) throw new Error("Not authenticated.");
    return updateUserProfile(ctx.userEmail, name);
  },
});
