import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { and, eq, ne } from "drizzle-orm";
import { createError } from "h3";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  ownerEmailMatches,
  requireOrganizationAccess,
} from "../server/lib/recordings.js";
import { TEAM_VOCABULARY_EDITOR_ROLES } from "../server/lib/vocabulary.js";

export default defineAction({
  description:
    "Remove a vocabulary entry by id. A personal entry can only be removed by its owner; a team entry only by an admin or owner of the organization it belongs to.",
  schema: z.object({
    id: z.string().describe("Vocabulary entry id"),
  }),
  http: { method: "DELETE" },
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      throw createError({
        statusCode: 401,
        statusMessage: "Authentication required",
      });
    }

    const db = getDb();
    const [personal] = await db
      .select({ id: schema.vocabulary.id })
      .from(schema.vocabulary)
      .where(
        and(
          eq(schema.vocabulary.id, args.id),
          ownerEmailMatches(schema.vocabulary.ownerEmail, ownerEmail),
          ne(schema.vocabulary.visibility, "org"),
        ),
      )
      .limit(1);

    if (!personal) {
      const [team] = await db
        .select({ orgId: schema.vocabulary.orgId })
        .from(schema.vocabulary)
        .where(
          and(
            eq(schema.vocabulary.id, args.id),
            eq(schema.vocabulary.visibility, "org"),
          ),
        )
        .limit(1);
      if (!team?.orgId) {
        throw createError({
          statusCode: 404,
          statusMessage: "Vocabulary entry not found",
        });
      }
      // Throws 403 unless the caller is an admin or owner of the team's org,
      // which must also be their active organization.
      const { organizationId } = await requireOrganizationAccess(undefined, [
        ...TEAM_VOCABULARY_EDITOR_ROLES,
      ]);
      if (organizationId !== team.orgId) {
        throw createError({
          statusCode: 404,
          statusMessage: "Vocabulary entry not found",
        });
      }
    }

    await db.delete(schema.vocabulary).where(eq(schema.vocabulary.id, args.id));

    return { id: args.id };
  },
});
