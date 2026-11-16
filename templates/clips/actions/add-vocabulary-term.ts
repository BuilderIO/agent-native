import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { createError } from "h3";
import { z } from "zod";

import { requireOrganizationAccess } from "../server/lib/recordings.js";
import {
  TEAM_VOCABULARY_EDITOR_ROLES,
  upsertVocabularyTerm,
} from "../server/lib/vocabulary.js";

export default defineAction({
  description:
    'Record a vocabulary entry (term + preferred replacement). Future dictations bias toward the replacement. scope "personal" (default) is only for the caller; scope "team" shares it with everyone in the caller\'s active organization and needs an org admin or owner. For a name hint without a rewrite, use the same text for term and replacement.',
  schema: z.object({
    term: z
      .string()
      .min(1)
      .max(120)
      .describe("The original word/phrase the recognizer produced"),
    replacement: z.string().min(1).max(120).describe("The preferred spelling"),
    confidence: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("How confident this correction is (0..1)"),
    scope: z
      .enum(["personal", "team"])
      .default("personal")
      .describe(
        '"personal" for the caller only, "team" for everyone in the active organization (org admins and owners only)',
      ),
  }),
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      throw createError({
        statusCode: 401,
        statusMessage: "Authentication required",
      });
    }
    const scope = args.scope ?? "personal";
    const orgId =
      scope === "team"
        ? (
            await requireOrganizationAccess(undefined, [
              ...TEAM_VOCABULARY_EDITOR_ROLES,
            ])
          ).organizationId
        : null;
    return upsertVocabularyTerm({
      scope,
      ownerEmail,
      orgId,
      term: args.term,
      replacement: args.replacement,
      confidence: args.confidence,
    });
  },
});
