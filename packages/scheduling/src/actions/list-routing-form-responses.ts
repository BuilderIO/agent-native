import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { getSchedulingContext } from "../server/context.js";

export default defineAction({
  description: "List responses to a routing form",
  schema: z.object({ formId: z.string(), limit: z.number().optional() }),
  run: async (args) => {
    const { getDb, schema } = getSchedulingContext();
    const rows = await getDb()
      .select()
      .from(schema.routingFormResponses)
      .where(eq(schema.routingFormResponses.formId, args.formId))
      .orderBy(desc(schema.routingFormResponses.createdAt))
      .limit(args.limit ?? 100);
    return {
      responses: rows.map((r: any) => ({
        ...r,
        response: JSON.parse(r.response),
      })),
    };
  },
});
