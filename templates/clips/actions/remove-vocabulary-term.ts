/**
 * Remove a personal-vocabulary entry.
 *
 * Lets a user correct a bad auto-learned term (see `add-vocabulary-term`) or
 * clear a manually-added one. Owner-scoped delete — a row can only be removed
 * by the user who owns it.
 *
 * Usage:
 *   pnpm action remove-vocabulary-term --id=<id>
 */

import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { and, eq } from "drizzle-orm";
import { createError } from "h3";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { ownerEmailMatches } from "../server/lib/recordings.js";

export default defineAction({
  description:
    "Remove a personal-vocabulary entry by id. Only the owning user can remove their own terms.",
  schema: z.object({
    id: z.string().describe("Vocabulary entry id"),
  }),
  http: { method: "DELETE" },
  run: async (args) => {
    const ownerEmail = await getRequestUserEmail();
    if (!ownerEmail) {
      throw createError({
        statusCode: 401,
        statusMessage: "Authentication required",
      });
    }

    const db = getDb();
    const [existing] = await db
      .select()
      .from(schema.vocabulary)
      .where(
        and(
          eq(schema.vocabulary.id, args.id),
          ownerEmailMatches(schema.vocabulary.ownerEmail, ownerEmail),
        ),
      )
      .limit(1);
    if (!existing) {
      throw createError({
        statusCode: 404,
        statusMessage: "Vocabulary entry not found",
      });
    }

    await db.delete(schema.vocabulary).where(eq(schema.vocabulary.id, args.id));

    return { id: args.id };
  },
});
