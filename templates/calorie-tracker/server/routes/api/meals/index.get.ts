import { defineEventHandler, getQuery } from "h3";
import { db } from "../../../db/index.js";
import { schema } from "../../../db/index.js";
import { eq, desc } from "drizzle-orm";

export default defineEventHandler(async (event) => {
  const { date } = getQuery(event);
  if (!date) return { error: "Date parameter is required" };

  const result = await db()
    .select()
    .from(schema.meals)
    .where(eq(schema.meals.date, String(date)))
    .orderBy(desc(schema.meals.created_at));

  return result;
});
