import { defineAction } from "@agent-native/core";
import { accessFilter } from "@agent-native/core/sharing";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { serializeProposal } from "../server/lib/brain.js";

export default defineAction({
  description: "List Brain knowledge proposals requiring review.",
  schema: z.object({
    status: z.enum(["pending", "approved", "rejected"]).default("pending"),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ status, limit }) => {
    const rows = await getDb()
      .select()
      .from(schema.brainProposals)
      .where(
        and(
          accessFilter(schema.brainProposals, schema.brainProposalShares),
          eq(schema.brainProposals.status, status),
        ),
      )
      .orderBy(desc(schema.brainProposals.createdAt))
      .limit(limit);
    return { count: rows.length, proposals: rows.map(serializeProposal) };
  },
});
