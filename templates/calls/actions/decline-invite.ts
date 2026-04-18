/**
 * Decline a workspace invite — deletes the invite row so the token cannot be
 * reused.
 *
 * Usage:
 *   pnpm action decline-invite --token=<token>
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
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
import { writeAppState, readAppState } from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Decline a workspace invite. Deletes the invite row so the token cannot be reused.",
  schema: z.object({
    token: z.string().min(1).describe("Invite token"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const db = getDb();
    const [invite] = await db
      .select()
      .from(schema.invites)
      .where(eq(schema.invites.token, args.token))
      .limit(1);
    if (!invite) return { declined: false, error: "Invite not found." };

    await db.delete(schema.invites).where(eq(schema.invites.id, invite.id));
    await writeAppState("refresh-signal", { ts: Date.now() });
    return { declined: true, workspaceId: invite.workspaceId };
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
