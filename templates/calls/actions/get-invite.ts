/**
 * Lookup a workspace invite by its token.
 *
 * Usage:
 *   pnpm action get-invite --token=<token>
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
import {
  writeAppState,
  readAppState,
} from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Fetch a workspace invite by its token. Returns the invite row plus the workspace's name + brand color, or an error string if the invite is missing / already-accepted / expired.",
  schema: z.object({
    token: z.string().min(1).describe("Invite token"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    const [invite] = await db
      .select()
      .from(schema.invites)
      .where(eq(schema.invites.token, args.token))
      .limit(1);
    if (!invite) return { invite: null, error: "Invite not found." };
    if (invite.acceptedAt) {
      return { invite: null, error: "This invite has already been accepted." };
    }
    if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) {
      return { invite: null, error: "This invite has expired." };
    }
    const [ws] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, invite.workspaceId))
      .limit(1);
    if (!ws) return { invite: null, error: "Workspace no longer exists." };

    return {
      invite: {
        id: invite.id,
        workspaceId: invite.workspaceId,
        workspaceName: ws.name,
        workspaceBrandColor: ws.brandColor,
        email: invite.email,
        role: invite.role,
        invitedBy: invite.invitedBy,
        expiresAt: invite.expiresAt,
        acceptedAt: invite.acceptedAt,
      },
    };
  },
});

void getCurrentOwnerEmail;
void nanoid;
void parseSpaceIds;
void stringifySpaceIds;
void parseJson;
void resolveDefaultWorkspaceId;
void writeAppState;
void readAppState;
void accessFilter;
void assertAccess;
