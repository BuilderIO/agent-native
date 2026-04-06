import { defineEventHandler, readBody, createError } from "h3";
import { db } from "../../../db/index.js";
import { schema } from "../../../db/index.js";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  if (!body.date || typeof body.date !== "string") {
    throw createError({ statusCode: 400, statusMessage: "date is required" });
  }

  const result = await db()
    .insert(schema.exercises)
    .values({
      name: body.name,
      calories_burned: body.calories_burned || 0,
      duration_minutes: body.duration_minutes || null,
      date: String(body.date).split("T")[0],
      created_at: new Date(),
    })
    .returning();

  return result[0];
});
