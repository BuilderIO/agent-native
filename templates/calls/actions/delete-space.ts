/**
 * Delete a space. Cascades to space_members. By default, errors if any call
 * still references it — pass force=true to strip the space id from those
 * calls and delete anyway.
 *
 * Usage:
 *   pnpm action delete-space --id=<id>
 *   pnpm action delete-space --id=<id> --force=true
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
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
    "Delete a space. Cascades to space_members. Errors if any call's spaceIds still contains this space — either use remove-call-from-space first, or pass force=true to strip the space from all referencing calls.",
  schema: z.object({
    id: z.string().describe("Space id"),
    force: z
      .boolean()
      .default(false)
      .describe(
        "When true, strips this space from all calls' spaceIds before deleting.",
      ),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const db = getDb();
    const [existing] = await db
      .select()
      .from(schema.spaces)
      .where(eq(schema.spaces.id, args.id))
      .limit(1);
    if (!existing) throw new Error(`Space not found: ${args.id}`);

    const needle = `%"${args.id.replace(/%/g, "")}"%`;
    const affected = await db
      .select()
      .from(schema.calls)
      .where(sql`${schema.calls.spaceIds} LIKE ${needle}`);

    if (affected.length > 0 && !args.force) {
      throw new Error(
        `Space "${existing.name}" is still referenced by ${affected.length} call(s). Use remove-call-from-space for each, or re-run with force=true to strip the space from all of them.`,
      );
    }

    for (const c of affected) {
      const ids = parseSpaceIds(c.spaceIds).filter((x) => x !== args.id);
      await db
        .update(schema.calls)
        .set({
          spaceIds: stringifySpaceIds(ids),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.calls.id, c.id));
    }

    await db
      .delete(schema.spaceMembers)
      .where(eq(schema.spaceMembers.spaceId, args.id));
    await db.delete(schema.spaces).where(eq(schema.spaces.id, args.id));

    await writeAppState("refresh-signal", { ts: Date.now() });
    console.log(
      `Deleted space ${args.id} and cleared it from ${affected.length} call(s)`,
    );
    return {
      id: args.id,
      callsCleaned: affected.length,
    };
  },
});

void getCurrentOwnerEmail;
void nanoid;
void parseJson;
void resolveDefaultWorkspaceId;
void readAppState;
void accessFilter;
void assertAccess;
