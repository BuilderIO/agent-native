import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  parseSpaceIds,
  requireOrganizationAccess,
  stringifySpaceIds,
} from "../server/lib/recordings.js";

export default defineAction({
  description:
    "Delete a space. Removes the space row, its members, and clears the space id from any recordings that referenced it.",
  schema: z.object({
    id: z.string().describe("Space id"),
  }),
  run: async (args) => {
    const db = getDb();
    const [existing] = await db
      .select()
      .from(schema.spaces)
      .where(eq(schema.spaces.id, args.id));
    if (!existing) throw new Error(`Space not found: ${args.id}`);
    await requireOrganizationAccess(existing.organizationId, ["admin"]);

    const needle = `%"${args.id.replace(/%/g, "")}"%`;
    const affected = await db
      .select({
        id: schema.recordings.id,
        spaceIds: schema.recordings.spaceIds,
      })
      .from(schema.recordings)
      // guard:allow-unscoped — after organization-admin authorization, this cleanup scans recordings in that organization to remove references to its deleted space.
      .where(
        and(
          eq(schema.recordings.organizationId, existing.organizationId),
          sql`${schema.recordings.spaceIds} LIKE ${needle}`,
        ),
      );

    for (const r of affected) {
      const ids = parseSpaceIds(r.spaceIds).filter((x) => x !== args.id);
      await db
        .update(schema.recordings)
        .set({
          spaceIds: stringifySpaceIds(ids),
          updatedAt: new Date().toISOString(),
        })
        // guard:allow-unscoped — keep the cleanup update in the same organization-admin tenant scope as its source query.
        .where(
          and(
            eq(schema.recordings.id, r.id),
            eq(schema.recordings.organizationId, existing.organizationId),
          ),
        );
    }

    await db
      .delete(schema.spaceMembers)
      .where(eq(schema.spaceMembers.spaceId, args.id));

    await db.delete(schema.spaces).where(eq(schema.spaces.id, args.id));

    await writeAppState("refresh-signal", { ts: Date.now() });
    console.log(
      `Deleted space ${args.id} and cleared it from ${affected.length} recording(s)`,
    );
    return {
      id: args.id,
      recordingsCleaned: affected.length,
    };
  },
});
