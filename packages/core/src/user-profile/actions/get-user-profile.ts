import { z } from "zod";

import { defineAction } from "../../action.js";
import type { UserProfile } from "../shared.js";
import { getUserProfile } from "../store.js";

export default defineAction({
  description:
    "Get the current user's profile, including the display name used across Agent-Native apps.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async (_args, ctx): Promise<UserProfile> => {
    if (!ctx?.userEmail) throw new Error("Not authenticated.");
    return getUserProfile(ctx.userEmail);
  },
});
