import {
  defineEventHandler,
  readBody,
  getRouterParam,
  setResponseStatus,
} from "h3";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../../../db";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Composition id is required" };
  }

  const body = await readBody(event);
  if (!body || typeof body !== "object") {
    setResponseStatus(event, 400);
    return { error: "Invalid composition data" };
  }

  const db = getDb();
  const now = new Date().toISOString();

  const updates: Record<string, any> = { updatedAt: now };
  if (body.title !== undefined) updates.title = body.title;
  if (body.type !== undefined) updates.type = body.type;
  if (body.data !== undefined) updates.data = JSON.stringify(body.data);

  const result = await db
    .update(schema.compositions)
    .set(updates)
    .where(eq(schema.compositions.id, id))
    .returning();

  if (result.length > 0) {
    const row = result[0];
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
