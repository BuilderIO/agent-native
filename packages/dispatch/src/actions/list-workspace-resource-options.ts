import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { listWorkspaceResourceOptions } from "../server/lib/workspace-resources-store.js";

export default defineAction({
  description:
    "List lightweight workspace resource options for selectors, without returning full content.",
  schema: z.object({
    kind: z
      .enum(["skill", "instruction", "agent", "knowledge"])
      .optional()
      .describe("Filter by resource kind"),
  }),
  http: { method: "GET" },
  run: async (args) => listWorkspaceResourceOptions(args),
});
