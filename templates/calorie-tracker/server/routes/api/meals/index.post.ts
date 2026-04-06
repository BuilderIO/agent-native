import { defineEventHandler, readBody } from "h3";
import { db } from "../../../db/index.js";
import { schema } from "../../../db/index.js";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const result = await db()
    .insert(schema.meals)
    .values({
      name: body.name,
      calories: body.calories || 0,
      protein: body.protein || null,
      carbs: body.carbs || null,
      fat: body.fat || null,
      date: String(body.date).split("T")[0],
      image_url: body.image_url || body.imageUrl || null,
      notes: body.notes || null,
      created_at: new Date(),
    })
    .returning();

  return result[0];
});
