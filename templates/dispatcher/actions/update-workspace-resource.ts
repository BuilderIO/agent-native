import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { updateWorkspaceResource } from "../server/lib/workspace-resources-store.js";

export default defineAction({
  description:
    "Update a workspace resource's name, description, content, or scope.",
  schema: z.object({
    id: z.string().describe("Resource ID"),
    name: z.string().optional().describe("New name"),
    description: z.string().optional().describe("New description"),
    content: z.string().optional().describe("New content"),
    scope: z.enum(["all", "selected"]).optional().describe("New scope"),
  }),
  run: async (args) => {
    const { id, ...rest } = args;
    return updateWorkspaceResource(id, rest);
  },
});
