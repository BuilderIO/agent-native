import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { setAppCreationSettings } from "../server/lib/app-creation-store.js";

export default defineAction({
  description:
    "Set Dispatch settings for creating new workspace apps, and the Builder project this organization uses for cloud code changes. Stores the project id as an organization-scoped credential; does not write env vars or files.",
  schema: z.object({
    builderProjectId: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .optional()
      .nullable()
      .describe(
        "Builder project ID used for app-creation branches and for cloud code-change branches across this organization's workspace apps. Pass null to clear it and return those apps to the connect/waitlist prompt.",
      ),
  }),
  run: async (args) => setAppCreationSettings(args),
});
