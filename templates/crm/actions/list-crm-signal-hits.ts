import { defineAction } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { and, desc, eq, like, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "List bounded, access-scoped CRM signals. Results contain evidence references and short excerpts, never transcripts or media.",
  schema: z.object({
    recordId: z.string().trim().min(1).max(128).optional(),
    reviewStatus: z.enum(["unreviewed", "confirmed", "dismissed"]).optional(),
    query: z.string().trim().max(120).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const filters = [accessFilter(schema.crmSignals, schema.crmSignalShares)];
    if (args.recordId)
      filters.push(eq(schema.crmSignals.recordId, args.recordId));
    if (args.reviewStatus)
      filters.push(eq(schema.crmSignals.reviewStatus, args.reviewStatus));
    if (args.query) {
      const escaped = args.query.replace(/[\\%_]/g, "\\$&");
      filters.push(
        or(
          like(schema.crmSignals.label, `%${escaped}%`),
          like(schema.crmSignals.quote, `%${escaped}%`),
          like(schema.crmSignals.summary, `%${escaped}%`),
        )!,
      );
    }
    const signals = await getDb()
      .select()
      .from(schema.crmSignals)
      .where(and(...filters))
      .orderBy(desc(schema.crmSignals.createdAt))
      .limit(args.limit);
    return { signals };
  },
});
