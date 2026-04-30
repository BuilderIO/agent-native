/**
 * Remove a member from a space.
 *
 * Usage:
 *   pnpm action remove-space-member --spaceId=<id> --email=alice@example.com
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { requireOrganizationAccess } from "../server/lib/recordings.js";

export default defineAction({
  description: "Remove a member from a space.",
  schema: z.object({
    spaceId: z.string().describe("Space id"),
    email: z.string().email().describe("Member email"),
  }),
  run: async (args) => {
    const db = getDb();
    const [space] = await db
      .select({ organizationId: schema.spaces.organizationId })
      .from(schema.spaces)
      .where(eq(schema.spaces.id, args.spaceId))
      .limit(1);
    if (!space) throw new Error(`Space not found: ${args.spaceId}`);
    await requireOrganizationAccess(space.organizationId, ["admin"]);

    const [existing] = await db
      .select()
      .from(schema.spaceMembers)
      .where(
        and(
          eq(schema.spaceMembers.spaceId, args.spaceId),
          eq(schema.spaceMembers.email, args.email),
        ),
      );
    if (!existing) {
      return { spaceId: args.spaceId, email: args.email, removed: false };
    }
    await db
      .delete(schema.spaceMembers)
      .where(eq(schema.spaceMembers.id, existing.id));
    await writeAppState("refresh-signal", { ts: Date.now() });
    return { spaceId: args.spaceId, email: args.email, removed: true };
  },
});
