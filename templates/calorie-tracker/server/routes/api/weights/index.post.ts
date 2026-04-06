import { defineEventHandler, readBody, createError } from "h3";
import { db } from "../../../db/index.js";
import { schema } from "../../../db/index.js";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  if (!body.date || typeof body.date !== "string") {
    throw createError({ statusCode: 400, statusMessage: "date is required" });
  }

  const result = await db()
    .insert(schema.weights)
    .values({
      weight: body.weight,
      date: String(body.date).split("T")[0],
      notes: body.notes || null,
      created_at: new Date(),
    })
    .returning();

  return result[0];
});
