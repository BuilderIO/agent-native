import { readBody } from "@agent-native/core/server";
import {
  accessFilter,
  resolveAccess,
  assertAccess,
  ForbiddenError,
} from "@agent-native/core/sharing";
import { eq, desc } from "drizzle-orm";
import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";

import { getDb, schema } from "../db";
import { withSlidesRequestContext } from "./request-auth-context.js";

/**
 * Resolve the caller's auth context from the request and run `fn` inside a
 * `runWithRequestContext` scope so `accessFilter` / `resolveAccess` /
 * `assertAccess` can read it. ALL `/api/design-systems/*` handlers MUST go
 * through this — querying ownable tables without a request context is how
 * data leaks across users (see #SLI-2026-04-28).
 */
function handleForbidden(event: any, err: unknown): { error: string } {
  if (err instanceof ForbiddenError) {
    setResponseStatus(event, err.statusCode);
    return { error: err.message };
  }
  throw err;
}

export const listDesignSystems = defineEventHandler(async (event) => {
  return withSlidesRequestContext(event, async () => {
    const db = getDb();
    const rows = await db
      .select({
        id: schema.designSystems.id,
        title: schema.designSystems.title,
        description: schema.designSystems.description,
        isDefault: schema.designSystems.isDefault,
        visibility: schema.designSystems.visibility,
        createdAt: schema.designSystems.createdAt,
        updatedAt: schema.designSystems.updatedAt,
      })
      .from(schema.designSystems)
      .where(accessFilter(schema.designSystems, schema.designSystemShares))
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
});

export const getDesignSystem = defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Design system id is required" };
  }

  return withSlidesRequestContext(event, async () => {
    const access = await resolveAccess("design-system", id);
    if (!access) {
      setResponseStatus(event, 404);
      return { error: "Design system not found" };
    }
    const row = access.resource;
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
  });
});

export const createDesignSystem = defineEventHandler(async (event) => {
  const body = await readBody(event);

  if (!body || !body.id) {
    setResponseStatus(event, 400);
    return { error: "Design system must have an id" };
  }

  return withSlidesRequestContext(event, async ({ email, orgId }) => {
    if (!email) {
      return handleForbidden(
        event,
        new ForbiddenError("Sign in to create a design system"),
      );
    }

    const db = getDb();
    const now = new Date().toISOString();

    await db.insert(schema.designSystems).values({
      id: body.id,
      title: body.title || "Untitled",
      description: body.description ?? null,
      data:
        typeof body.data === "string" ? body.data : JSON.stringify(body.data),
      assets:
        body.assets != null
          ? typeof body.assets === "string"
            ? body.assets
            : JSON.stringify(body.assets)
          : null,
      isDefault: body.isDefault ?? false,
      ownerEmail: email,
      orgId: orgId ?? null,
      visibility: orgId ? "org" : "private",
      createdAt: now,
      updatedAt: now,
    });

    setResponseStatus(event, 201);
    return { id: body.id, title: body.title };
  });
});

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

  return withSlidesRequestContext(event, async () => {
    try {
      await assertAccess("design-system", id, "editor");

      const db = getDb();
      const now = new Date().toISOString();

      const updates: Record<string, unknown> = { updatedAt: now };
      if (body.title !== undefined) updates.title = body.title;
      if (body.description !== undefined)
        updates.description = body.description;
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
    } catch (err) {
      if (err instanceof ForbiddenError) {
        setResponseStatus(event, 404);
        return { error: "Design system not found" };
      }
      return handleForbidden(event, err);
    }
  });
});

export const deleteDesignSystem = defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Design system id is required" };
  }

  return withSlidesRequestContext(event, async () => {
    try {
      await assertAccess("design-system", id, "admin");
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
    } catch (err) {
      if (err instanceof ForbiddenError) {
        setResponseStatus(event, 404);
        return { error: "Design system not found" };
      }
      throw err;
    }
  });
});
