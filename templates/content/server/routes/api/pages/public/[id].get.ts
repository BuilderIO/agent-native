import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../../../../db/index.js";

/**
 * Public endpoint to serve published pages from the cloud database.
 * No auth required - this is the public sharing endpoint.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Missing page ID" };
  }

  const db = getDb();
  if (!db) {
    setResponseStatus(event, 503);
    return { error: "Cloud database not configured" };
  }

  const page = await db
    .select()
    .from(schema.pages)
    .where(eq(schema.pages.id, id))
    .get();

  if (!page) {
    setResponseStatus(event, 404);
    return { error: "Page not found" };
  }

  if (!page.publishedAt) {
    setResponseStatus(event, 404);
    return { error: "Page not published" };
  }

  return {
    id: page.id,
    workspace: page.workspace,
    project: page.project,
    title: page.title,
    content: page.content,
    metadata: page.metadata ? JSON.parse(page.metadata) : null,
    publishedAt: page.publishedAt,
    updatedAt: page.updatedAt,
  };
});
