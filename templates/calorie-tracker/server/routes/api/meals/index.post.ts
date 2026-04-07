import { defineEventHandler, readBody, createError } from "h3";
import { db } from "../../../db/index.js";
import { schema } from "../../../db/index.js";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  if (!body.date || typeof body.date !== "string") {
    throw createError({ statusCode: 400, statusMessage: "date is required" });
  }

  const result = await db()
    .insert(schema.meals)
    .values({
      name: body.name,
      calories: parseInt(body.calories) || 0,
      protein: body.protein ? parseFloat(body.protein) : null,
      carbs: body.carbs ? parseFloat(body.carbs) : null,
      fat: body.fat ? parseFloat(body.fat) : null,
      date: String(body.date).split("T")[0],
      image_url: body.image_url || body.imageUrl || null,
      notes: body.notes || null,
    })
    .returning();

  return result[0];
});
