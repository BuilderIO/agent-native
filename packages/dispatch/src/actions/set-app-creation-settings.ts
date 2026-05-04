import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { setAppCreationSettings } from "../server/lib/app-creation-store.js";

export default defineAction({
  description:
    "Set Dispatch settings for creating new workspace apps. Does not write env vars or files.",
  schema: z.object({
    builderProjectId: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .optional()
      .nullable()
      .describe("Default Builder project ID to use for app creation branches"),
  }),
  run: async (args) => setAppCreationSettings(args),
});
