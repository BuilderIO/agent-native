import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { previewWorkspaceResourceChange } from "../server/lib/workspace-resources-store.js";

export default defineAction({
  description:
    "Preview the impact of creating, updating, or deleting a workspace resource, including All-app reach, overrides, and whether Dispatch approval will be requested.",
  schema: z.object({
    operation: z
      .enum(["create", "update", "delete"])
      .optional()
      .describe("Change operation to preview."),
    resourceId: z.string().optional().describe("Existing resource id."),
    path: z
      .string()
      .optional()
      .describe("Resource path, such as context/brand.md."),
    scope: z
      .enum(["all", "selected"])
      .optional()
      .describe("Resulting resource scope after the change."),
  }),
  http: { method: "GET" },
  run: async (args) => previewWorkspaceResourceChange(args),
});
