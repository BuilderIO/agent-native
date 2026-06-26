/**
 * Decline an organization invite.
 *
 * Marks the invitation as rejected (keeps the row for audit).
 *
 * Usage:
 *   pnpm action decline-invite --token=<token>
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { orgInvitations } from "@agent-native/core/org";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";

export default defineAction({
  description:
    "Decline an organization invite. Marks the invitation as rejected so the token can't be reused.",
  schema: z.object({
    token: z.string().min(1).describe("Invite token (invitation id)"),
  }),
  run: async (args) => {
    const db = getDb();
    const [invite] = await db
      .select({
        id: orgInvitations.id,
        orgId: orgInvitations.orgId,
      })
      .from(orgInvitations)
      .where(eq(orgInvitations.id, args.token))
      .limit(1);
    if (!invite) {
      return { declined: false, error: "Invite not found." };
    }

    await db
      .update(orgInvitations)
      .set({ status: "rejected" })
      .where(eq(orgInvitations.id, invite.id));

    await writeAppState("refresh-signal", { ts: Date.now() });
    return { declined: true, organizationId: invite.orgId };
  },
});
