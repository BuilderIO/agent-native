import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";
import { eq, desc } from "drizzle-orm";
import { getDb, schema } from "../db";
import {
  readBody,
  getSession,
  runWithRequestContext,
} from "@agent-native/core/server";
import {
  accessFilter,
  resolveAccess,
  assertAccess,
  ForbiddenError,
} from "@agent-native/core/sharing";

/**
 * Resolve the caller's auth context from the request and run `fn` inside a
 * `runWithRequestContext` scope so `accessFilter` / `resolveAccess` /
 * `assertAccess` can read it. ALL `/api/design-systems/*` handlers MUST go
 * through this — querying ownable tables without a request context is how
 * data leaks across users (see #SLI-2026-04-28).
 */
async function withAuth<T>(
  event: any,
  fn: (session: { email?: string; orgId?: string }) => Promise<T>,
): Promise<T> {
  const session = await getSession(event).catch(() => null);
  const ctx = {
    userEmail: session?.email,
    orgId: session?.orgId,
  };
  return runWithRequestContext(ctx, () =>
    fn({ email: ctx.userEmail, orgId: ctx.orgId }),
  );
}

function handleForbidden(event: any, err: unknown): { error: string } {
  if (err instanceof ForbiddenError) {
    setResponseStatus(event, err.statusCode);
    return { error: err.message };
  }
  throw err;
}

// GET /api/design-systems — list design systems the caller can see
// (own + shared + visibility match)
export const listDesignSystems = defineEventHandler(async (event) => {
  return withAuth(event, async () => {
    const db = getDb();
    const rows = await db
      .select()
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

// GET /api/design-systems/:id — get a specific design system
// (caller must have viewer+ access)
export const getDesignSystem = defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Design system id is required" };
  }

  return withAuth(event, async () => {
    const access = await resolveAccess("design-system", id);
    if (!access) {
      // Return 404 (not 403) so we don't leak existence of design
      // systems the caller has no access to.
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

// POST /api/design-systems — create a new design system owned by the caller
export const createDesignSystem = defineEventHandler(async (event) => {
  const body = await readBody(event);

  if (!body || !body.id) {
    setResponseStatus(event, 400);
    return { error: "Design system must have an id" };
  }

  return withAuth(event, async ({ email, orgId }) => {
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
      createdAt: now,
      updatedAt: now,
    });

    setResponseStatus(event, 201);
    return { id: body.id, title: body.title };
  });
});

// PUT /api/design-systems/:id — update a design system (must have editor+ access)
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

  return withAuth(event, async () => {
    try {
      // assertAccess loads the row and verifies the caller has editor+
      // role on this resource — it must run BEFORE the update (and in
      // the same scope) so we don't leak existence to non-editors.
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
        // Return 404 (not 403) so we don't leak the existence of design
        // systems the caller has no access to.
        setResponseStatus(event, 404);
        return { error: "Design system not found" };
      }
      return handleForbidden(event, err);
    }
  });
});

// DELETE /api/design-systems/:id — delete a design system (admin or owner only)
export const deleteDesignSystem = defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Design system id is required" };
  }

  return withAuth(event, async () => {
    try {
      // assertAccess loads the row and verifies the caller has admin
      // role on this resource — it must run BEFORE the delete (and in
      // the same scope) so we don't leak existence to callers who lack
      // access.
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
        // 404 to avoid leaking existence
        setResponseStatus(event, 404);
        return { error: "Design system not found" };
      }
      throw err;
    }
  });
});
