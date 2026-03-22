import { defineEventHandler } from "h3";
import { desc } from "drizzle-orm";
import { getDb, schema } from "../../../db";

export default defineEventHandler(async () => {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.compositions)
    .orderBy(desc(schema.compositions.updatedAt));

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    type: row.type,
    data: JSON.parse(row.data),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
});
