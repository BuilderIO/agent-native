import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Confirm, dismiss, or return one access-scoped CRM signal to the unreviewed queue.",
  schema: z.object({
    signalId: z.string().trim().min(1).max(128),
    reviewStatus: z.enum(["unreviewed", "confirmed", "dismissed"]),
  }),
  run: async (args) => {
    await assertAccess("crm-signal", args.signalId, "editor");
    const now = new Date().toISOString();
    await getDb()
      .update(schema.crmSignals)
      .set({ reviewStatus: args.reviewStatus, updatedAt: now })
      .where(eq(schema.crmSignals.id, args.signalId));
    const [saved] = await getDb()
      .select()
      .from(schema.crmSignals)
      .where(eq(schema.crmSignals.id, args.signalId))
      .limit(1);
    if (!saved)
      throw new Error("CRM signal could not be verified after review.");
    return saved;
  },
});
