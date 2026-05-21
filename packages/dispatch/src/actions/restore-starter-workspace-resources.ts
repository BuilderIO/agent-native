import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { restoreStarterWorkspaceResources } from "../server/lib/workspace-resources-store.js";

export default defineAction({
  description:
    "Restore missing starter global workspace resources such as company, brand, messaging, guardrails, and company voice. Existing resources are left unchanged.",
  schema: z.object({
    paths: z
      .array(z.string())
      .optional()
      .describe(
        "Optional starter resource paths to restore. Omit to restore every missing starter resource.",
      ),
  }),
  run: async (args) => restoreStarterWorkspaceResources(args),
});
