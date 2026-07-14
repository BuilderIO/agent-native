import { defineAction } from "@agent-native/core";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server";
import { z } from "zod";

import { upsertAnalysisWithRetry } from "../server/lib/dashboards-store";

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
    // Fenced through the retry helper: the patch below only ever touches
    // `name`, so a concurrent edit (e.g. save-analysis re-running with fresh
    // results) racing this rename is never silently overwritten — a lost
    // race just re-reads the freshest record and reapplies the rename.
    const analysis = await upsertAnalysisWithRetry(args.id, ctx, () => ({
      name,
    }));
    return { id: analysis.id, name: analysis.name };
  },
});
