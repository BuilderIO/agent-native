/**
 * Return the org members for a recording's organization so comment composers
 * can autocomplete @mentions against the right roster.
 *
 * Usage:
 *   pnpm action list-recording-mention-members --recordingId=<id>
 */

import { defineAction } from "@agent-native/core/action";
import { orgMembers } from "@agent-native/core/org";
import { resolveAccess, ForbiddenError } from "@agent-native/core/sharing";
import { isEmailDerivedName } from "@agent-native/core/user-profile";
import { getUserProfiles } from "@agent-native/core/user-profile/server";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { isRecordingExpired } from "../server/lib/recording-page-access.js";

export default defineAction({
  description:
    "Return the organization members for a recording so comment composers can autocomplete mentions against the recording's org roster.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const access = await resolveAccess("recording", args.recordingId);
    if (!access) {
      throw new ForbiddenError(`No access to recording ${args.recordingId}`);
    }

    const rec = access.resource as {
      expiresAt?: string | null;
      organizationId: string;
    };

    if (isRecordingExpired(rec.expiresAt)) {
      throw new ForbiddenError("Recording has expired");
    }

    const db = getDb();
    const memberRows = await db
      .select({
        email: orgMembers.email,
      })
      .from(orgMembers)
      .where(eq(orgMembers.orgId, rec.organizationId))
      .orderBy(asc(orgMembers.email));

    const profiles = await getUserProfiles(
      memberRows.map((member) => member.email),
    );
    const members = memberRows.map((member) => {
      const name = profiles.get(member.email.toLowerCase())?.name;
      return {
        email: member.email,
        ...(name && !isEmailDerivedName(name, member.email) ? { name } : {}),
      };
    });

    return { members };
  },
});
