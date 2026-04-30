import { defineAction } from "@agent-native/core";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { writeAppState } from "@agent-native/core/application-state";
import {
  getCurrentOwnerEmail,
  nanoid,
  requireOrganizationAccess,
} from "../server/lib/recordings.js";

export default defineAction({
  description:
    "Create a new folder in the library or a space. Supports nesting via parentId.",
  schema: z.object({
    name: z.string().min(1).describe("Folder name"),
    organizationId: z
      .string()
      .optional()
      .describe(
        "Organization id the folder lives in (defaults to the caller's active org)",
      ),
    spaceId: z
      .string()
      .nullish()
      .describe("Space id — omit for a personal library folder"),
    parentId: z
      .string()
      .nullish()
      .describe("Parent folder id for nesting — omit for root"),
  }),
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    const id = nanoid();
    const now = new Date().toISOString();
    const { organizationId } = await requireOrganizationAccess(
      args.organizationId,
    );

    if (args.spaceId) {
      const [space] = await db
        .select({ id: schema.spaces.id })
        .from(schema.spaces)
        .where(
          and(
            eq(schema.spaces.id, args.spaceId),
            eq(schema.spaces.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!space) throw new Error(`Space not found: ${args.spaceId}`);
    }

    if (args.parentId) {
      const [parent] = await db
        .select({ id: schema.folders.id })
        .from(schema.folders)
        .where(
          and(
            eq(schema.folders.id, args.parentId),
            eq(schema.folders.organizationId, organizationId),
            eq(schema.folders.ownerEmail, ownerEmail),
          ),
        )
        .limit(1);
      if (!parent) throw new Error(`Parent folder not found: ${args.parentId}`);
    }

    // Next position within siblings
    const whereClauses = [
      eq(schema.folders.organizationId, organizationId),
      eq(schema.folders.ownerEmail, ownerEmail),
    ];
    whereClauses.push(
      args.spaceId
        ? eq(schema.folders.spaceId, args.spaceId)
        : isNull(schema.folders.spaceId),
    );
    whereClauses.push(
      args.parentId
        ? eq(schema.folders.parentId, args.parentId)
        : isNull(schema.folders.parentId),
    );

    const [maxRow] = await db
      .select({ max: sql<number>`COALESCE(MAX(position), -1)` })
      .from(schema.folders)
      .where(and(...whereClauses));
    const position = (maxRow?.max ?? -1) + 1;

    await db.insert(schema.folders).values({
      id,
      organizationId,
      parentId: args.parentId ?? null,
      spaceId: args.spaceId ?? null,
      ownerEmail,
      name: args.name,
      position,
      createdAt: now,
    });

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      id,
      organizationId,
      parentId: args.parentId ?? null,
      spaceId: args.spaceId ?? null,
      ownerEmail,
      name: args.name,
      position,
      createdAt: now,
    };
  },
});
