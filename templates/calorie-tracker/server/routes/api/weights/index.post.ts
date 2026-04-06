import { defineEventHandler, readBody } from "h3";
import { db } from "../../../db/index.js";
import { schema } from "../../../db/index.js";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
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
