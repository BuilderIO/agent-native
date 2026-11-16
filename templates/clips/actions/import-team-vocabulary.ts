import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { createError } from "h3";
import { z } from "zod";

import { requireOrganizationAccess } from "../server/lib/recordings.js";
import {
  TEAM_VOCABULARY_EDITOR_ROLES,
  importTeamVocabulary,
} from "../server/lib/vocabulary.js";

export default defineAction({
  description:
    "Bulk-add team vocabulary entries (shared with everyone in the active organization), for example the names of all colleagues. Org admins and owners only. An entry without a replacement is a spelling hint: the term itself is the preferred spelling.",
  schema: z.object({
    entries: z
      .array(
        z.object({
          term: z.string().min(1).max(120),
          replacement: z.string().min(1).max(120).optional(),
        }),
      )
      .min(1)
      .max(500)
      .describe("Team words to add or update"),
  }),
  needsApproval: true,
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      throw createError({
        statusCode: 401,
        statusMessage: "Authentication required",
      });
    }
    const { organizationId } = await requireOrganizationAccess(undefined, [
      ...TEAM_VOCABULARY_EDITOR_ROLES,
    ]);
    const result = await importTeamVocabulary({
      orgId: organizationId,
      ownerEmail,
      entries: args.entries,
    });
    return { organizationId, ...result };
  },
});
