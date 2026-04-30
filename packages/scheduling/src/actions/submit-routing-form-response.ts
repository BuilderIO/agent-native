import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { nanoid } from "nanoid";
import { getSchedulingContext } from "../server/context.js";

export default defineAction({
  description: "Store a public routing form submission response",
  schema: z.object({
    formId: z.string(),
    response: z.record(z.string(), z.any()),
    bookingId: z.string().optional(),
    matchedRuleId: z.string().optional(),
    routedTo: z.string().optional(),
    submitterEmail: z.string().optional(),
  }),
  run: async (args) => {
    const { getDb, schema } = getSchedulingContext();
    const id = nanoid();
    await getDb()
      .insert(schema.routingFormResponses)
      .values({
        id,
        formId: args.formId,
        response: JSON.stringify(args.response),
        bookingId: args.bookingId ?? null,
        matchedRuleId: args.matchedRuleId ?? null,
        routedTo: args.routedTo ?? null,
        submitterEmail: args.submitterEmail ?? null,
        submitterIp: null,
        createdAt: new Date().toISOString(),
      });
    return { id };
  },
});
