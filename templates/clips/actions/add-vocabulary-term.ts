/**
 * Record a personal-vocabulary correction.
 *
 * Wispr-style auto-learn: after a dictation paste the desktop renderer
 * watches the focused field for ~10s. If the user edits a word during that
 * window, the diffed `{term, replacement}` pair is sent here. Future
 * dictations bias the recognizer's `contextualStrings` toward the
 * `replacement` so the user's preferred spelling wins next time.
 *
 * Idempotent: if the same term already exists for this owner, bumps
 * `usesCount` and refreshes the replacement / confidence.
 *
 * Usage:
 *   pnpm action add-vocabulary-term --term="kubectl" --replacement="kubectl"
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { nanoid } from "../server/lib/recordings.js";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";

export default defineAction({
  description:
    "Record a personal vocabulary correction (term + user's preferred replacement). Future dictations bias toward the replacement.",
  schema: z.object({
    term: z
      .string()
      .min(1)
      .max(120)
      .describe("The original word/phrase the recognizer produced"),
    replacement: z
      .string()
      .min(1)
      .max(120)
      .describe("The user's preferred spelling"),
    confidence: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("How confident this correction is (0..1)"),
  }),
  run: async (args) => {
    const ownerEmail = (await getRequestUserEmail()) || "local@localhost";
    const db = getDb();
    const term = args.term.trim();
    const replacement = args.replacement.trim();
    if (!term || !replacement || term === replacement) {
      return { id: null, skipped: true };
    }
    const now = new Date().toISOString();
    // Look up an existing entry for this owner+term — bump usesCount.
    const [existing] = await db
      .select()
      .from(schema.vocabulary)
      .where(
        and(
          eq(schema.vocabulary.ownerEmail, ownerEmail),
          eq(schema.vocabulary.term, term),
        ),
      )
      .limit(1);
    if (existing) {
      const nextConfidence = Math.min(
        1,
        (args.confidence ?? existing.confidence) +
          (existing.replacement === replacement ? 0.05 : 0),
      );
      await db
        .update(schema.vocabulary)
        .set({
          replacement,
          confidence: nextConfidence,
          usesCount: (existing.usesCount ?? 1) + 1,
          updatedAt: now,
        })
        .where(eq(schema.vocabulary.id, existing.id));
      return { id: existing.id, updated: true };
    }
    const id = `vocab_${nanoid()}`;
    await db.insert(schema.vocabulary).values({
      id,
      term,
      replacement,
      confidence: args.confidence ?? 0.5,
      usesCount: 1,
      createdAt: now,
      updatedAt: now,
      ownerEmail,
      orgId: null,
      visibility: "private",
    });
    return { id, created: true };
  },
});
