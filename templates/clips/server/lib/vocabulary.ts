import { and, eq, ne, sql } from "drizzle-orm";
import { createError } from "h3";

import { getDb, schema } from "../db/index.js";
import { nanoid, ownerEmailMatches } from "./recordings.js";

/**
 * Personal words belong to one person. Team words (`visibility: "org"`) are
 * shared with everyone in the organization that owns them.
 */
export type VocabularyScope = "personal" | "team";

/** The organization roles that may add or remove team words. */
export const TEAM_VOCABULARY_EDITOR_ROLES = ["admin"] as const;

/**
 * How many team words one organization can have. Adding past it is refused,
 * which keeps the team list (read without a limit) bounded.
 */
export const MAX_TEAM_VOCABULARY = 1000;

function teamVocabularyFull(): Error {
  return createError({
    statusCode: 409,
    statusMessage: `An organization can have at most ${MAX_TEAM_VOCABULARY} team words. Remove some first.`,
  });
}

async function countTeamWords(orgId: string): Promise<number> {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)` })
    .from(schema.vocabulary)
    .where(
      and(
        eq(schema.vocabulary.visibility, "org"),
        eq(schema.vocabulary.orgId, orgId),
      ),
    );
  return Number(row?.count ?? 0);
}

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

/** A unique-index violation (Postgres 23505, or SQLite's message). */
export function isUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const { code, message, cause } = current as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (code === "23505") return true;
    if (typeof message === "string" && /unique constraint/i.test(message)) {
      return true;
    }
    current = cause;
  }
  return false;
}

function matchFor(input: UpsertVocabularyTermInput, term: string) {
  return input.scope === "team"
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
}

/**
 * Adds a word, or updates the existing one with the same term in the same
 * scope. A personal word never matches a team word and the other way round,
 * so an admin's team word never swallows their own personal correction.
 *
 * Team words are unique per organization and lowercased term (see
 * vocabulary-schema.ts). When two admins add the same team word at once, the losing insert
 * hits that index and updates the winner's row instead.
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

  const updateExisting =
    async (): Promise<UpsertVocabularyTermResult | null> => {
      const [existing] = await db
        .select()
        .from(schema.vocabulary)
        .where(matchFor(input, term))
        .limit(1);
      if (!existing) return null;
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
    };

  const updated = await updateExisting();
  if (updated) return updated;
  if (
    input.scope === "team" &&
    (await countTeamWords(input.orgId as string)) >= MAX_TEAM_VOCABULARY
  ) {
    throw teamVocabularyFull();
  }

  const id = `vocab_${nanoid()}`;
  try {
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
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await updateExisting();
    if (raced) return raced;
    throw error;
  }
  return { id, created: true, scope: input.scope };
}

export interface TeamVocabularyImportResult {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
}

/**
 * Adds or updates many team words with one read of the organization's team
 * words, one batched insert for the new ones and an update only for words
 * whose replacement changed. Entries with the same term (any casing) collapse
 * to the last one. If another admin inserts one of the same words meanwhile,
 * the batch falls back to the conflict-safe single upsert per new word.
 */
export async function importTeamVocabulary(input: {
  orgId: string;
  ownerEmail: string;
  entries: Array<{ term: string; replacement?: string }>;
}): Promise<TeamVocabularyImportResult> {
  const result: TeamVocabularyImportResult = {
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
  };
  const wanted = new Map<string, { term: string; replacement: string }>();
  for (const entry of input.entries) {
    const term = entry.term.trim();
    const replacement = (entry.replacement ?? entry.term).trim();
    if (!term || !replacement) {
      result.skipped += 1;
      continue;
    }
    wanted.set(termKey(term), { term, replacement });
  }
  if (wanted.size === 0) return result;

  const db = getDb();
  const now = new Date().toISOString();
  const existingRows = await db
    .select()
    .from(schema.vocabulary)
    .where(
      and(
        eq(schema.vocabulary.visibility, "org"),
        eq(schema.vocabulary.orgId, input.orgId),
      ),
    );
  const existing = new Map(existingRows.map((row) => [termKey(row.term), row]));
  let freshCount = 0;
  for (const key of wanted.keys()) if (!existing.has(key)) freshCount += 1;
  if (existingRows.length + freshCount > MAX_TEAM_VOCABULARY) {
    throw teamVocabularyFull();
  }

  const fresh: Array<{ term: string; replacement: string }> = [];
  for (const [key, entry] of wanted) {
    const row = existing.get(key);
    if (!row) {
      fresh.push(entry);
      continue;
    }
    if (row.replacement === entry.replacement) {
      result.unchanged += 1;
      continue;
    }
    await db
      .update(schema.vocabulary)
      .set({ replacement: entry.replacement, confidence: 1, updatedAt: now })
      .where(eq(schema.vocabulary.id, row.id));
    result.updated += 1;
  }

  if (fresh.length > 0) {
    try {
      await db.insert(schema.vocabulary).values(
        fresh.map((entry) => ({
          id: `vocab_${nanoid()}`,
          term: entry.term,
          replacement: entry.replacement,
          confidence: 1,
          usesCount: 1,
          createdAt: now,
          updatedAt: now,
          ownerEmail: input.ownerEmail,
          orgId: input.orgId,
          visibility: "org" as const,
        })),
      );
      result.created += fresh.length;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      for (const entry of fresh) {
        const single = await upsertVocabularyTerm({
          scope: "team",
          ownerEmail: input.ownerEmail,
          orgId: input.orgId,
          term: entry.term,
          replacement: entry.replacement,
          confidence: 1,
        });
        if ("created" in single) result.created += 1;
        else if ("updated" in single) result.updated += 1;
      }
    }
  }
  return result;
}
