import {
  defineEventHandler,
  getRouterParam,
  setResponseStatus,
  createError,
} from "h3";
import { eq, desc } from "drizzle-orm";
import { getDb, schema } from "../db";
import { readBody } from "@agent-native/core/server";

// GET /api/design-systems — list all design systems
export const listDesignSystems = defineEventHandler(async (_event) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.designSystems)
    .orderBy(desc(schema.designSystems.updatedAt));

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    isDefault: row.isDefault,
    visibility: row.visibility,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
});

// GET /api/design-systems/:id — get a specific design system
export const getDesignSystem = defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Design system id is required" };
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(schema.designSystems)
    .where(eq(schema.designSystems.id, id))
    .limit(1);

  if (rows.length > 0) {
    const row = rows[0];
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      data: row.data ? JSON.parse(row.data) : null,
      assets: row.assets ? JSON.parse(row.assets) : null,
      isDefault: row.isDefault,
      visibility: row.visibility,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  setResponseStatus(event, 404);
  return { error: "Design system not found" };
});

// POST /api/design-systems — create a new design system
export const createDesignSystem = defineEventHandler(async (event) => {
  const body = await readBody(event);

  if (!body || !body.id) {
    setResponseStatus(event, 400);
    return { error: "Design system must have an id" };
  }

  const db = getDb();
  const now = new Date().toISOString();

  await db.insert(schema.designSystems).values({
    id: body.id,
    title: body.title || "Untitled",
    description: body.description ?? null,
    data: typeof body.data === "string" ? body.data : JSON.stringify(body.data),
    assets:
      body.assets != null
        ? typeof body.assets === "string"
          ? body.assets
          : JSON.stringify(body.assets)
        : null,
    isDefault: body.isDefault ?? false,
    ownerEmail: (() => {
      if (body.ownerEmail) return body.ownerEmail as string;
      throw createError({
        statusCode: 401,
        statusMessage: "ownerEmail required",
      });
    })(),
    orgId: body.orgId ?? null,
    createdAt: now,
    updatedAt: now,
  });

  setResponseStatus(event, 201);
  return { id: body.id, title: body.title };
});

// PUT /api/design-systems/:id — update a design system
export const updateDesignSystem = defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Design system id is required" };
  }

  const body = await readBody(event);
  if (!body || typeof body !== "object") {
    setResponseStatus(event, 400);
    return { error: "Invalid design system data" };
  }

  const db = getDb();
  const now = new Date().toISOString();

  const updates: Record<string, unknown> = { updatedAt: now };
  if (body.title !== undefined) updates.title = body.title;
  if (body.description !== undefined) updates.description = body.description;
  if (body.data !== undefined)
    updates.data =
      typeof body.data === "string" ? body.data : JSON.stringify(body.data);
  if (body.assets !== undefined)
    updates.assets =
      body.assets != null
        ? typeof body.assets === "string"
          ? body.assets
          : JSON.stringify(body.assets)
        : null;
  if (body.isDefault !== undefined) updates.isDefault = body.isDefault;

  await db
    .update(schema.designSystems)
    .set(updates)
    .where(eq(schema.designSystems.id, id));

  return { id, updated: true };
});

// DELETE /api/design-systems/:id — delete a design system
export const deleteDesignSystem = defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Design system id is required" };
  }

  const db = getDb();
  const result = await db
    .delete(schema.designSystems)
    .where(eq(schema.designSystems.id, id))
    .returning();

  if (result.length > 0) {
    return { success: true };
  } else {
    setResponseStatus(event, 404);
    return { error: "Design system not found" };
  }
});
