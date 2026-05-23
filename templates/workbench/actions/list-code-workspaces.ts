import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";

/**
 * List the local filesystem workspaces the current user has registered
 * for the Code Room. Per-user only — scoped by `ownerEmail`. Returns the
 * absolute path on disk plus a friendly label; the UI uses these to
 * populate the workspace picker in the Code Room.
 */
export default defineAction({
  description:
    "List the local filesystem workspaces the current user has registered " +
    "for the Code Room. Returns absolute paths and labels.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      throw new Error("Sign in to list your code workspaces.");
    }

    const db = getDb();
    const rows = await db
      .select({
        id: schema.workbenchCodeWorkspaces.id,
        label: schema.workbenchCodeWorkspaces.label,
        path: schema.workbenchCodeWorkspaces.path,
        isDefault: schema.workbenchCodeWorkspaces.isDefault,
        addedAt: schema.workbenchCodeWorkspaces.addedAt,
      })
      .from(schema.workbenchCodeWorkspaces)
      .where(eq(schema.workbenchCodeWorkspaces.ownerEmail, ownerEmail))
      .orderBy(desc(schema.workbenchCodeWorkspaces.addedAt));

    return {
      workspaces: rows.map((row) => ({
        id: row.id,
        label: row.label,
        path: row.path,
        isDefault: Boolean(row.isDefault),
        addedAt: row.addedAt,
      })),
    };
  },
});
