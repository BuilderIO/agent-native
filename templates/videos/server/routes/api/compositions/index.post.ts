import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { getDb, schema } from "../../../db";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  if (!body || !body.id || !body.title || !body.type) {
    setResponseStatus(event, 400);
    return { error: "Composition must have id, title, and type" };
  }

  const now = new Date().toISOString();
  const db = getDb();

  await db.insert(schema.compositions).values({
    id: body.id,
    title: body.title,
    type: body.type,
    data: JSON.stringify(body.data || {}),
    createdAt: now,
    updatedAt: now,
  });

  setResponseStatus(event, 201);
  return {
    id: body.id,
    title: body.title,
    type: body.type,
    data: body.data || {},
    createdAt: now,
    updatedAt: now,
  };
});
