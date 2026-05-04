import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { listWorkspaceResources } from "../server/lib/workspace-resources-store.js";

export default defineAction({
  description:
    "List all workspace-wide resources (skills, instructions, agents) that can be shared across apps.",
  schema: z.object({
    kind: z
      .enum(["skill", "instruction", "agent"])
      .optional()
      .describe("Filter by resource kind"),
  }),
  http: { method: "GET" },
  run: async (args) => listWorkspaceResources(args),
});
