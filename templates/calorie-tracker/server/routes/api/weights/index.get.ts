import { defineEventHandler, getQuery } from "h3";
import { db } from "../../../db/index.js";
import { schema } from "../../../db/index.js";
import { eq, desc } from "drizzle-orm";

export default defineEventHandler(async (event) => {
  const { date } = getQuery(event);
  if (!date) return { error: "Date parameter is required" };

  return await db()
    .select()
    .from(schema.weights)
    .where(eq(schema.weights.date, String(date)))
    .orderBy(desc(schema.weights.created_at));
});
