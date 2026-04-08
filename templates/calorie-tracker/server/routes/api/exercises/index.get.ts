import { defineEventHandler, getQuery } from "h3";
import { db } from "../../../db/index.js";
import { schema } from "../../../db/index.js";
import { eq, desc } from "drizzle-orm";

export default defineEventHandler(async (event) => {
  const { date } = getQuery(event);
  if (!date) return [];

  return await db()
    .select()
    .from(schema.exercises)
    .where(eq(schema.exercises.date, String(date)))
    .orderBy(desc(schema.exercises.created_at));
});
