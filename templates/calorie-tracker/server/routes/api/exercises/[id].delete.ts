import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";
import { db } from "../../../db/index.js";
import { schema } from "../../../db/index.js";
import { eq } from "drizzle-orm";

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, "id"));
  await db().delete(schema.exercises).where(eq(schema.exercises.id, id));
  setResponseStatus(event, 204);
  return null;
});
