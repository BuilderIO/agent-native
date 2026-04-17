/**
 * Decline (delete) a workspace invite.
 *
 * Usage:
 *   pnpm action decline-invite --token=<token>
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Decline a workspace invite. Deletes the invite row so the token can't be reused.",
  schema: z.object({
    token: z.string().min(1).describe("Invite token"),
  }),
  run: async (args) => {
    const db = getDb();
    const [invite] = await db
      .select()
      .from(schema.invites)
      .where(eq(schema.invites.token, args.token));
    if (!invite) {
      return { declined: false, error: "Invite not found." };
    }
    await db.delete(schema.invites).where(eq(schema.invites.id, invite.id));
    await writeAppState("refresh-signal", { ts: Date.now() });
    return { declined: true, workspaceId: invite.workspaceId };
  },
});
