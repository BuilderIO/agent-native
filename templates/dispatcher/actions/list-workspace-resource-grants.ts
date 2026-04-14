import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { listResourceGrants } from "../server/lib/workspace-resources-store.js";

export default defineAction({
  description:
    "List workspace resource grants — which apps have access to which shared skills, instructions, and agents.",
  schema: z.object({
    resourceId: z.string().optional().describe("Filter by resource ID"),
    appId: z.string().optional().describe("Filter by app ID"),
  }),
  http: { method: "GET" },
  run: async (args) => listResourceGrants(args),
});
