import { defineAction } from "@agent-native/core";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server";
import { z } from "zod";
import { upsertAnalysis } from "../server/lib/dashboards-store";

function resolveScope() {
  const orgId = getRequestOrgId() || null;
  const email = getRequestUserEmail();
  if (!email) throw new Error("no authenticated user");
  return { orgId, email };
}

export default defineAction({
  description: "Rename a saved ad-hoc analysis by ID.",
  schema: z.object({
    id: z.string().describe("The analysis ID to rename"),
    name: z.string().describe("The new analysis name"),
  }),
  run: async (args) => {
    const name = args.name.trim();
    if (!name) throw new Error("name is required");

    const ctx = resolveScope();
    const analysis = await upsertAnalysis(args.id, { name }, ctx);
    return { id: analysis.id, name: analysis.name };
  },
});
