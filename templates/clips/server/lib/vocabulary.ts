import { and, eq, ne, sql } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { nanoid, ownerEmailMatches } from "./recordings.js";

/**
 * Personal words belong to one person. Team words (`visibility: "org"`) are
 * shared with everyone in the organization that owns them.
 */
export type VocabularyScope = "personal" | "team";

/** The organization roles that may add or remove team words. */
export const TEAM_VOCABULARY_EDITOR_ROLES = ["admin"] as const;

type VocabularyRow = typeof schema.vocabulary.$inferSelect;

export type ScopedVocabularyEntry = VocabularyRow & { scope: VocabularyScope };

export function vocabularyScope(row: {
  visibility?: string | null;
}): VocabularyScope {
  return row.visibility === "org" ? "team" : "personal";
}

function termKey(term: string): string {
  return term.trim().toLocaleLowerCase();
}

/**
 * The vocabulary dictation should use: every personal word, plus each team
 * word whose term the person has no personal word for. A personal word with
 * the same term (any casing) wins over the team word, and one team word per
 * term is kept.
 */
export function mergeVocabulary(
  rows: VocabularyRow[],
): ScopedVocabularyEntry[] {
  const scoped = rows.map((row) => ({ ...row, scope: vocabularyScope(row) }));
  const personal = scoped.filter((row) => row.scope === "personal");
  const taken = new Set(personal.map((row) => termKey(row.term)));
  const merged: ScopedVocabularyEntry[] = [...personal];
  for (const row of scoped) {
    if (row.scope !== "team") continue;
    const key = termKey(row.term);
    if (taken.has(key)) continue;
    taken.add(key);
    merged.push(row);
  }
  return merged;
}

export interface UpsertVocabularyTermInput {
  scope: VocabularyScope;
  ownerEmail: string;
  /** Required for team words: the organization they are shared with. */
  orgId?: string | null;
  term: string;
  replacement: string;
  confidence?: number;
}

export type UpsertVocabularyTermResult =
  | { id: null; skipped: true }
  | { id: string; updated: true; scope: VocabularyScope }
  | { id: string; created: true; scope: VocabularyScope };

/**
 * Adds a word, or updates the existing one with the same term in the same
 * scope. A personal word never matches a team word and the other way round,
 * so an admin's team word never swallows their own personal correction.
 */
export async function upsertVocabularyTerm(
  input: UpsertVocabularyTermInput,
): Promise<UpsertVocabularyTermResult> {
  const term = input.term.trim();
  const replacement = input.replacement.trim();
  if (!term || !replacement) return { id: null, skipped: true };
  if (input.scope === "team" && !input.orgId) {
    throw new Error("A team word needs an organization");
  }

  const db = getDb();
  const now = new Date().toISOString();
  const match =
    input.scope === "team"
      ? and(
          eq(schema.vocabulary.visibility, "org"),
          eq(schema.vocabulary.orgId, input.orgId as string),
          sql`lower(${schema.vocabulary.term}) = ${termKey(term)}`,
        )
      : and(
          ownerEmailMatches(schema.vocabulary.ownerEmail, input.ownerEmail),
          ne(schema.vocabulary.visibility, "org"),
          eq(schema.vocabulary.term, term),
        );

  const [existing] = await db
    .select()
    .from(schema.vocabulary)
    .where(match)
    .limit(1);
  if (existing) {
    const nextConfidence = Math.min(
      1,
      (input.confidence ?? existing.confidence) +
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
    return { id: existing.id, updated: true, scope: input.scope };
  }

  const id = `vocab_${nanoid()}`;
  await db.insert(schema.vocabulary).values({
    id,
    term,
    replacement,
    confidence: input.confidence ?? 0.5,
    usesCount: 1,
    createdAt: now,
    updatedAt: now,
    ownerEmail: input.ownerEmail,
    orgId: input.scope === "team" ? (input.orgId as string) : null,
    visibility: input.scope === "team" ? "org" : "private",
  });
  return { id, created: true, scope: input.scope };
}
