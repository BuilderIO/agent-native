/**
 * Create a new folder. workspaceId is required; parentId and spaceId are
 * optional — omitting both creates a root-level personal folder.
 *
 * Usage:
 *   pnpm action create-folder --workspaceId=<id> --name="Enterprise"
 *   pnpm action create-folder --workspaceId=<id> --name="Objections" --parentId=<fid>
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import {
  getCurrentOwnerEmail,
  nanoid,
  parseSpaceIds,
  stringifySpaceIds,
  parseJson,
  resolveDefaultWorkspaceId,
} from "../server/lib/calls.js";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import {
  writeAppState,
  readAppState,
} from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Create a new folder in the library or inside a space. Supports nesting via parentId. Returns the new folder's id + position.",
  schema: z.object({
    name: z.string().min(1).describe("Folder name"),
    workspaceId: z
      .string()
      .min(1)
      .describe("Workspace id the folder belongs to"),
    spaceId: z
      .string()
      .nullish()
      .describe("Space id — omit for a personal library folder"),
    parentId: z
      .string()
      .nullish()
      .describe("Parent folder id for nesting — omit for root level"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    const id = nanoid();
    const now = new Date().toISOString();

    const whereClauses = [
      eq(schema.folders.workspaceId, args.workspaceId),
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
      workspaceId: args.workspaceId,
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
      workspaceId: args.workspaceId,
      parentId: args.parentId ?? null,
      spaceId: args.spaceId ?? null,
      ownerEmail,
      name: args.name,
      position,
      createdAt: now,
    };
  },
});

void parseSpaceIds;
void stringifySpaceIds;
void parseJson;
void resolveDefaultWorkspaceId;
void readAppState;
void accessFilter;
void assertAccess;
