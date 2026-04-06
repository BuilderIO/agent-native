import { defineEventHandler, readBody, getRouterParam } from "h3";
import { db } from "../../../db/index.js";
import { schema } from "../../../db/index.js";
import { eq } from "drizzle-orm";

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, "id"));
  const body = await readBody(event);

  const result = await db()
    .update(schema.exercises)
    .set({
      name: body.name,
      calories_burned: body.calories_burned,
      duration_minutes: body.duration_minutes ?? null,
      date: body.date ? String(body.date).split("T")[0] : undefined,
    })
    .where(eq(schema.exercises.id, id))
    .returning();

  return result[0];
});
