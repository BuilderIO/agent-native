import { defineAction } from "@agent-native/core";
import { accessFilter } from "@agent-native/core/sharing";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { contractStatusSchema, summarizeContracts } from "./_contracts.js";

export default defineAction({
  description:
    "List Visual Plans with review, annotation, and proof summaries.",
  schema: z.object({
    status: contractStatusSchema.optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const rows = await getDb()
      .select()
      .from(schema.contracts)
      .where(accessFilter(schema.contracts, schema.contractShares))
      .orderBy(desc(schema.contracts.updatedAt));
    const filtered = args.status
      ? rows.filter((contract) => contract.status === args.status)
      : rows;
    return summarizeContracts(filtered);
  },
});
