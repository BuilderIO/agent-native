import { defineEventHandler, readBody, getRouterParam } from "h3";
import { db } from "../../../db/index.js";
import { schema } from "../../../db/index.js";
import { eq } from "drizzle-orm";

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, "id"));
  const body = await readBody(event);

  const result = await db()
    .update(schema.meals)
    .set({
      name: body.name,
      calories: body.calories,
      protein: body.protein ?? null,
      carbs: body.carbs ?? null,
      fat: body.fat ?? null,
      date: body.date ? String(body.date).split("T")[0] : undefined,
      image_url: body.image_url || body.imageUrl || null,
      notes: body.notes ?? null,
    })
    .where(eq(schema.meals.id, id))
    .returning();

  return result[0];
});
