import { defineEventHandler, readBody, getRouterParam } from "h3";
import { db } from "../../../db/index.js";
import { schema } from "../../../db/index.js";
import { eq } from "drizzle-orm";

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, "id"));
  const body = await readBody(event);

  const result = await db()
    .update(schema.weights)
    .set({
      weight: body.weight,
      date: body.date ? String(body.date).split("T")[0] : undefined,
      notes: body.notes ?? null,
    })
    .where(eq(schema.weights.id, id))
    .returning();

  return result[0];
});
