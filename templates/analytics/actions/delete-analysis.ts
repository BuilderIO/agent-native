import { defineAction } from "@agent-native/core";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server";
import { z } from "zod";
import { removeAnalysis } from "../server/lib/dashboards-store";

export default defineAction({
  description: "Delete a saved ad-hoc analysis by ID.",
  schema: z.object({
    id: z.string().describe("The analysis ID to delete"),
  }),
  http: false,
  run: async (args) => {
    const orgId = getRequestOrgId() || null;
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    await removeAnalysis(args.id, { email, orgId });
    return `Analysis "${args.id}" deleted.`;
  },
});
