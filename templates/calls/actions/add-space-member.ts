/**
 * Add (or update the role of) a member in a space.
 *
 * Usage:
 *   pnpm action add-space-member --spaceId=<id> --email=alice@example.com --role=contributor
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
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

const RoleEnum = z.enum(["viewer", "contributor", "admin"]);

export default defineAction({
  description:
    "Add a member to a space (or update their role if they are already a member).",
  schema: z.object({
    spaceId: z.string().describe("Space id"),
    email: z.string().email().describe("Member email"),
    role: RoleEnum.default("contributor").describe("Role within the space"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const db = getDb();
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

void getCurrentOwnerEmail;
void parseSpaceIds;
void stringifySpaceIds;
void parseJson;
void resolveDefaultWorkspaceId;
void readAppState;
void accessFilter;
void assertAccess;
