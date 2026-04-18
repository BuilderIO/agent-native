/**
 * Remove a member from a space.
 *
 * Usage:
 *   pnpm action remove-space-member --spaceId=<id> --email=alice@example.com
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

export default defineAction({
  description: "Remove a member from a space.",
  schema: z.object({
    spaceId: z.string().describe("Space id"),
    email: z.string().email().describe("Member email"),
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

void getCurrentOwnerEmail;
void nanoid;
void parseSpaceIds;
void stringifySpaceIds;
void parseJson;
void resolveDefaultWorkspaceId;
void readAppState;
void accessFilter;
void assertAccess;
