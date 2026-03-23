import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../../../db";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Composition id is required" };
  }

  const db = getDb();
  const result = await db
    .delete(schema.compositions)
    .where(eq(schema.compositions.id, id))
    .returning();

  if (result.length > 0) {
    return { success: true };
  }

  setResponseStatus(event, 404);
  return { error: "Composition not found" };
});
