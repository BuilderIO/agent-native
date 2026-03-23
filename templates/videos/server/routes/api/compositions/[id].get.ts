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
  const rows = await db
    .select()
    .from(schema.compositions)
    .where(eq(schema.compositions.id, id))
    .limit(1);

  if (rows.length > 0) {
    const row = rows[0];
    return {
      id: row.id,
      title: row.title,
      type: row.type,
      data: JSON.parse(row.data),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  setResponseStatus(event, 404);
  return { error: "Composition not found" };
});
