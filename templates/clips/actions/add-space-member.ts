/**
 * Add a member to a space.
 *
 * Usage:
 *   pnpm action add-space-member --spaceId=<id> --email=alice@example.com --role=contributor
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { nanoid, requireOrganizationAccess } from "../server/lib/recordings.js";

const RoleEnum = z.enum(["viewer", "contributor", "admin"]);

export default defineAction({
  description:
    "Add a member to a space (or update their role if they're already a member).",
  schema: z.object({
    spaceId: z.string().describe("Space id"),
    email: z.string().email().describe("Member email"),
    role: RoleEnum.default("contributor").describe("Role within the space"),
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
    if (existing) {
      await db
        .update(schema.spaceMembers)
        .set({ role: args.role })
        .where(eq(schema.spaceMembers.id, existing.id));
    } else {
      await db.insert(schema.spaceMembers).values({
        id: nanoid(),
        spaceId: args.spaceId,
        email: args.email,
        role: args.role,
      });
    }

    await writeAppState("refresh-signal", { ts: Date.now() });
    return { spaceId: args.spaceId, email: args.email, role: args.role };
  },
});
