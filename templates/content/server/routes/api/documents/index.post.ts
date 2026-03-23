import { defineEventHandler, readBody } from "h3";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../../../db/index.js";
import { schema } from "../../../db/index.js";

function nanoid(size = 12): string {
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let id = "";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  for (const byte of bytes) id += chars[byte % chars.length];
  return id;
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const db = getDb();

  const parentId = body.parentId ?? null;

  // Get max position among siblings
  const maxPos = await db
    .select({ max: sql<number>`COALESCE(MAX(position), -1)` })
    .from(schema.documents)
    .where(
      parentId
        ? eq(schema.documents.parentId, parentId)
        : sql`parent_id IS NULL`,
    );

  const position = (maxPos[0]?.max ?? -1) + 1;
  const now = new Date().toISOString();
  const id = nanoid();

  await db.insert(schema.documents).values({
    id,
    parentId,
    title: body.title ?? "Untitled",
    content: body.content ?? "",
    icon: body.icon ?? null,
    position,
    isFavorite: 0,
    createdAt: now,
    updatedAt: now,
  });

  const [doc] = await db
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, id));

  return {
    id: doc.id,
    parentId: doc.parentId,
    title: doc.title,
    content: doc.content,
    icon: doc.icon,
    position: doc.position,
    isFavorite: Boolean(doc.isFavorite),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
});
