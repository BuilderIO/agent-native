import { defineAction } from "@agent-native/core";
import {
  getRequestUserEmail,
  todayInTimezone,
} from "@agent-native/core/server";
import { db, schema } from "../server/db/index.js";
import { z } from "zod";

export default defineAction({
  description:
    "Log a weight entry. This action writes the weight row to the database and returns the saved row; after it succeeds, do not call db-schema, db-query, db-exec, docs-search, web-request/fetch, raw HTTP, or action HTTP endpoints to verify or insert the same weight.",
  schema: z.object({
    weight: z.coerce.number().describe("Weight in pounds"),
    date: z
      .string()
      .optional()
      .describe("Date in YYYY-MM-DD format (defaults to today)"),
    notes: z.string().optional().describe("Optional notes"),
  }),
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    const date = args.date || todayInTimezone();

    const result = await db()
      .insert(schema.weights)
      .values({
        owner_email: ownerEmail,
        weight: args.weight,
        date: String(date).split("T")[0],
        notes: args.notes || null,
      })
      .returning();

    return result[0];
  },
});
