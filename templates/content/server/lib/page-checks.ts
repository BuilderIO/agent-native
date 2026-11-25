import { ActionContractError } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { ForbiddenError, ROLE_RANK } from "@agent-native/core/sharing";
import { and, asc, eq, notInArray } from "drizzle-orm";

import { readBlocksFieldIdentity } from "../../actions/_blocks-field-identity.js";
import { bodyBlocksPropertyIds } from "../../actions/_body-block-fields.js";
import { resolveDocumentAccess } from "../../actions/_document-access.js";
import { flushOpenDocumentEditorToSql } from "../../actions/_document-flush.js";
import { nanoid } from "../../actions/_property-utils.js";
import { identityBlockIds } from "../../shared/block-identity-ids.js";
import {
  checkPageCheckPlace,
  isFreshPageCheckResult,
  PAGE_CHECK_LIMIT,
  pageCheckAnswers,
  pageCheckHeadings,
  pageCheckPlaces,
  pageCheckWordingHash,
  readablePageCheckParts,
  readPageCheckSentence,
  type PageCheck,
  type PageCheckPart,
  type PageCheckPlaceAnswer,
  type PageCheckResult,
  type PageCheckScope,
  type PageCheckSkip,
} from "../../shared/page-checks.js";
import { getDb, schema } from "../db/index.js";
import { firstRow } from "./first-row.js";

type CheckRow = typeof schema.contentPageChecks.$inferSelect;
type ResultRow = typeof schema.contentPageCheckResults.$inferSelect;

/** Where a check looks, as asked: a section may name only its heading. */
export type PageCheckScopeInput =
  | Exclude<PageCheckScope, { kind: "section" }>
  | (Omit<Extract<PageCheckScope, { kind: "section" }>, "headingId"> & {
      headingId?: string | null;
    });

/** A check with what each of its places shows now. */
export interface PageCheckView extends PageCheck {
  answers: PageCheckPlaceAnswer[];
}

function nowIso() {
  return new Date().toISOString();
}

function currentUserEmail(): string {
  const email = getRequestUserEmail();
  if (!email) {
    throw new ActionContractError("Sign in to use checks.", {
      errorCode: "AUTH_REQUIRED",
      statusCode: 401,
    });
  }
  return email;
}

/**
 * The page, for someone with at least this role on it. Commenters read checks,
 * editors change and run them, and viewers get nothing.
 */
export async function pageCheckAccess(
  documentId: string,
  minRole: "commenter" | "editor",
) {
  const access = await resolveDocumentAccess(documentId);
  if (!access || access.resource.trashedAt) {
    throw new ForbiddenError(`No access to document ${documentId}`);
  }
  if (ROLE_RANK[access.role] < ROLE_RANK[minRole]) {
    throw new ForbiddenError(
      `Requires ${minRole} role on document ${documentId} (have ${access.role})`,
    );
  }
  return access;
}

/**
 * The page body as saved, after asking an open editor to save first. A failed
 * save leaves the last saved body, whose places then show as changed.
 */
async function savedBody(
  documentId: string,
  options: { editorSaved?: boolean; minRole: "commenter" | "editor" },
) {
  if (!options.editorSaved) {
    const access = await pageCheckAccess(documentId, options.minRole);
    try {
      await flushOpenDocumentEditorToSql({
        documentId,
        ownerEmail: (access.resource.ownerEmail as string | undefined) || null,
      });
    } catch {
      // The saved body is still a body to check.
    }
  }
  const access = await pageCheckAccess(documentId, options.minRole);
  const markdown = (access.resource.content as string | null | undefined) ?? "";
  return { access, markdown, idsByPath: await bodyIdsByPath(documentId, markdown) };
}

/** The body's block IDs by path, or none on a page without them. */
async function bodyIdsByPath(
  documentId: string,
  markdown: string,
): Promise<Record<string, string>> {
  const [propertyId] = await bodyBlocksPropertyIds(documentId);
  if (!propertyId) return {};
  const identity = await readBlocksFieldIdentity({
    documentId,
    propertyId,
    markdown,
  });
  if (identity.identityStatus === "stale") return {};
  return identityBlockIds(identity.blocks).idsByPath;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function checkFromRow(row: CheckRow): PageCheck {
  return {
    id: row.id,
    documentId: row.documentId,
    sentence: row.sentence,
    parts: parseJson<PageCheckPart[]>(row.parts, []),
    scope: parseJson<PageCheckScope>(row.scope, { kind: "page" }),
    wordingHash: row.wordingHash,
    paused: row.paused,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function resultFromRow(row: ResultRow): PageCheckResult {
  return {
    placeKey: row.placeKey,
    wordingHash: row.wordingHash,
    textHash: row.textHash,
    finding: row.finding as PageCheckResult["finding"],
    parts: parseJson<PageCheckResult["parts"]>(row.parts, []),
    checkedBy: row.checkedBy,
    checkedAt: row.checkedAt,
  };
}

async function loadPageChecks(documentId: string, checkIds?: string[]) {
  const db = getDb();
  const [checks, results, skips] = await Promise.all([
    db
      .select()
      .from(schema.contentPageChecks)
      .where(eq(schema.contentPageChecks.documentId, documentId))
      .orderBy(
        asc(schema.contentPageChecks.createdAt),
        asc(schema.contentPageChecks.id),
      ),
    db
      .select()
      .from(schema.contentPageCheckResults)
      .where(eq(schema.contentPageCheckResults.documentId, documentId)),
    db
      .select()
      .from(schema.contentPageCheckSkips)
      .where(eq(schema.contentPageCheckSkips.documentId, documentId)),
  ]);
  const wanted = checkIds ? new Set(checkIds) : null;
  return checks
    .filter((row) => !wanted || wanted.has(row.id))
    .map((row) => ({
      check: checkFromRow(row),
      results: results
        .filter((result) => result.checkId === row.id)
        .map(resultFromRow),
      skips: skips
        .filter((skip) => skip.checkId === row.id)
        .map(
          (skip): PageCheckSkip => ({
            placeKey: skip.placeKey,
            textHash: skip.textHash,
            skippedBy: skip.skippedBy,
          }),
        ),
    }));
}

function viewOf(
  loaded: Awaited<ReturnType<typeof loadPageChecks>>[number],
  markdown: string,
  idsByPath: Record<string, string>,
): PageCheckView {
  return {
    ...loaded.check,
    answers: pageCheckAnswers(
      loaded.check,
      pageCheckPlaces(markdown, loaded.check.scope, idsByPath),
      loaded.results,
      loaded.skips,
    ),
  };
}

/** A page's checks and what each place shows in its saved body. Runs nothing. */
export async function listPageChecks(documentId: string) {
  const access = await pageCheckAccess(documentId, "commenter");
  const markdown = (access.resource.content as string | null | undefined) ?? "";
  const idsByPath = await bodyIdsByPath(documentId, markdown);
  const loaded = await loadPageChecks(documentId);
  return {
    documentId,
    canEdit: ROLE_RANK[access.role] >= ROLE_RANK.editor,
    checks: loaded.map((entry) => viewOf(entry, markdown, idsByPath)),
  };
}

function unreadableSentence(sentence: string): ActionContractError {
  const reading = readPageCheckSentence(sentence);
  return new ActionContractError(
    reading.tooManyParts
      ? "A check can have at most three parts."
      : "Content can't read every part of this check yet. It reads counts of words, sentences or paragraphs, like \"Under 120 words\".",
    {
      errorCode: "PAGE_CHECK_UNREADABLE",
      statusCode: 400,
      details: { parts: reading.parts, tooManyParts: reading.tooManyParts },
    },
  );
}

function checkNotFound(): ActionContractError {
  return new ActionContractError("That check doesn't exist.", {
    errorCode: "PAGE_CHECK_NOT_FOUND",
    statusCode: 404,
  });
}

/** What a sentence would find on the page, without saving it. */
export async function tryPageCheck(args: {
  documentId: string;
  sentence: string;
  scope: PageCheckScopeInput;
}) {
  const { markdown, idsByPath } = await savedBody(args.documentId, {
    minRole: "editor",
  });
  const reading = readPageCheckSentence(args.sentence);
  const parts = readablePageCheckParts(args.sentence);
  if (!parts) return { reading, answers: null };
  const scope = resolveScope(args.scope, markdown, idsByPath);
  const wordingHash = pageCheckWordingHash({ parts, scope });
  const places = pageCheckPlaces(markdown, scope, idsByPath);
  const results =
    places.status === "ok"
      ? places.places.map((place) => ({
          placeKey: place.key,
          wordingHash,
          textHash: place.textHash,
          checkedBy: "",
          checkedAt: "",
          ...checkPageCheckPlace(parts, place),
        }))
      : [];
  return {
    reading,
    answers: pageCheckAnswers({ wordingHash }, places, results, []),
  };
}

/**
 * Checks every place whose last answer is about other text or wording, stores
 * what it found, and forgets places that are gone. Two runs at once store one
 * answer per place.
 */
async function checkStalePlaces(args: {
  documentId: string;
  markdown: string;
  idsByPath: Record<string, string>;
  checkIds?: string[];
  checkedBy: string;
}) {
  const db = getDb();
  const loaded = await loadPageChecks(args.documentId, args.checkIds);
  for (const { check, results } of loaded) {
    if (check.paused) continue;
    const places = pageCheckPlaces(args.markdown, check.scope, args.idsByPath);
    if (places.status !== "ok") continue;
    const resultsByKey = new Map(
      results.map((result) => [result.placeKey, result]),
    );
    const checkedAt = nowIso();
    for (const place of places.places) {
      if (isFreshPageCheckResult(resultsByKey.get(place.key), check, place)) {
        continue;
      }
      const found = checkPageCheckPlace(check.parts, place);
      const values = {
        wordingHash: check.wordingHash,
        textHash: place.textHash,
        finding: found.finding,
        parts: JSON.stringify(found.parts),
        checkedBy: args.checkedBy,
        checkedAt,
      };
      await db
        .insert(schema.contentPageCheckResults)
        .values({
          checkId: check.id,
          documentId: args.documentId,
          placeKey: place.key,
          ...values,
        })
        .onConflictDoUpdate({
          target: [
            schema.contentPageCheckResults.checkId,
            schema.contentPageCheckResults.placeKey,
          ],
          set: values,
        });
    }
    const keys = places.places.map((place) => place.key);
    for (const table of [
      schema.contentPageCheckResults,
      schema.contentPageCheckSkips,
    ]) {
      await db
        .delete(table)
        .where(
          and(
            eq(table.checkId, check.id),
            keys.length > 0 ? notInArray(table.placeKey, keys) : undefined,
          ),
        );
    }
  }
}

/** Checks what changed since the last check and returns every check's answers. */
export async function runPageChecks(args: {
  documentId: string;
  checkIds?: string[];
  editorSaved?: boolean;
}) {
  const checkedBy = currentUserEmail();
  const { markdown, idsByPath } = await savedBody(args.documentId, {
    minRole: "editor",
    editorSaved: args.editorSaved,
  });
  await checkStalePlaces({ ...args, markdown, idsByPath, checkedBy });
  const loaded = await loadPageChecks(args.documentId);
  return {
    documentId: args.documentId,
    canEdit: true,
    checks: loaded.map((entry) => viewOf(entry, markdown, idsByPath)),
  };
}

async function loadCheckRow(documentId: string, checkId: string) {
  const row = firstRow(
    await getDb()
      .select()
      .from(schema.contentPageChecks)
      .where(
        and(
          eq(schema.contentPageChecks.id, checkId),
          eq(schema.contentPageChecks.documentId, documentId),
        ),
      ),
  );
  if (!row) throw checkNotFound();
  return row;
}

/**
 * A section by its heading's block ID when the page has them, so the check
 * follows the heading through a rename or a move.
 */
function resolveScope(
  scope: PageCheckScopeInput,
  markdown: string,
  idsByPath: Record<string, string>,
): PageCheckScope {
  if (scope.kind !== "section") return { kind: scope.kind };
  const headings = pageCheckHeadings(markdown, idsByPath);
  const heading = scope.headingId
    ? headings.find((candidate) => candidate.headingId === scope.headingId)
    : headings.find(
        (candidate) =>
          candidate.heading === scope.heading.trim() &&
          candidate.level === scope.level,
      );
  if (!heading) {
    throw new ActionContractError("That heading isn't on the page.", {
      errorCode: "PAGE_CHECK_SECTION_NOT_FOUND",
      statusCode: 404,
    });
  }
  return {
    kind: "section",
    headingId: heading.headingId,
    heading: heading.heading,
    level: heading.level,
  };
}

export async function addPageCheck(args: {
  documentId: string;
  sentence: string;
  scope: PageCheckScopeInput;
}) {
  const createdBy = currentUserEmail();
  const sentence = args.sentence.trim();
  const parts = readablePageCheckParts(sentence);
  if (!parts) throw unreadableSentence(sentence);
  const { markdown, idsByPath } = await savedBody(args.documentId, {
    minRole: "editor",
  });
  const scope = resolveScope(args.scope, markdown, idsByPath);
  const db = getDb();
  const existing = await db
    .select({ id: schema.contentPageChecks.id })
    .from(schema.contentPageChecks)
    .where(eq(schema.contentPageChecks.documentId, args.documentId));
  if (existing.length >= PAGE_CHECK_LIMIT) {
    throw new ActionContractError(
      `A page can have at most ${PAGE_CHECK_LIMIT} checks.`,
      { errorCode: "PAGE_CHECK_LIMIT", statusCode: 409 },
    );
  }
  const id = nanoid();
  const at = nowIso();
  await db.insert(schema.contentPageChecks).values({
    id,
    documentId: args.documentId,
    createdBy,
    sentence,
    parts: JSON.stringify(parts),
    scope: JSON.stringify(scope),
    wordingHash: pageCheckWordingHash({ parts, scope }),
    paused: false,
    createdAt: at,
    updatedAt: at,
  });
  const listed = await runPageChecks({
    documentId: args.documentId,
    checkIds: [id],
    editorSaved: true,
  });
  return { checkId: id, ...listed };
}

export async function updatePageCheck(args: {
  documentId: string;
  checkId: string;
  sentence?: string;
  scope?: PageCheckScopeInput;
  paused?: boolean;
}) {
  const { markdown, idsByPath } = await savedBody(args.documentId, {
    minRole: "editor",
  });
  const row = await loadCheckRow(args.documentId, args.checkId);
  const current = checkFromRow(row);
  const sentence = args.sentence?.trim() ?? current.sentence;
  const parts =
    args.sentence === undefined
      ? current.parts
      : readablePageCheckParts(sentence);
  if (!parts) throw unreadableSentence(sentence);
  const scope = args.scope
    ? resolveScope(args.scope, markdown, idsByPath)
    : current.scope;
  await getDb()
    .update(schema.contentPageChecks)
    .set({
      sentence,
      parts: JSON.stringify(parts),
      scope: JSON.stringify(scope),
      wordingHash: pageCheckWordingHash({ parts, scope }),
      paused: args.paused ?? current.paused,
      updatedAt: nowIso(),
    })
    .where(eq(schema.contentPageChecks.id, args.checkId));
  return runPageChecks({
    documentId: args.documentId,
    checkIds: [args.checkId],
    editorSaved: true,
  });
}

export async function deletePageCheck(args: {
  documentId: string;
  checkId: string;
}) {
  await pageCheckAccess(args.documentId, "editor");
  await loadCheckRow(args.documentId, args.checkId);
  const db = getDb();
  await db
    .delete(schema.contentPageCheckSkips)
    .where(eq(schema.contentPageCheckSkips.checkId, args.checkId));
  await db
    .delete(schema.contentPageCheckResults)
    .where(eq(schema.contentPageCheckResults.checkId, args.checkId));
  await db
    .delete(schema.contentPageChecks)
    .where(eq(schema.contentPageChecks.id, args.checkId));
  return { documentId: args.documentId, checkId: args.checkId, deleted: true };
}

/**
 * Leaves one place alone until its text changes, or with `undo`, stops leaving
 * it alone. The text is the place's text in the saved body unless the open
 * editor names the text it showed.
 */
export async function skipPageCheckPlace(args: {
  documentId: string;
  checkId: string;
  placeKey: string;
  textHash?: string;
  undo?: boolean;
}) {
  const skippedBy = currentUserEmail();
  await pageCheckAccess(args.documentId, "editor");
  const check = checkFromRow(await loadCheckRow(args.documentId, args.checkId));
  const db = getDb();
  const where = and(
    eq(schema.contentPageCheckSkips.checkId, args.checkId),
    eq(schema.contentPageCheckSkips.placeKey, args.placeKey),
  );
  if (args.undo) {
    await db.delete(schema.contentPageCheckSkips).where(where);
    return { documentId: args.documentId, checkId: args.checkId, skipped: false };
  }
  let textHash = args.textHash;
  if (!textHash) {
    const { markdown, idsByPath } = await savedBody(args.documentId, {
      minRole: "editor",
    });
    const places = pageCheckPlaces(markdown, check.scope, idsByPath);
    textHash =
      places.status === "ok"
        ? places.places.find((place) => place.key === args.placeKey)?.textHash
        : undefined;
    if (!textHash) {
      throw new ActionContractError("That place isn't on the page anymore.", {
        errorCode: "PAGE_CHECK_PLACE_NOT_FOUND",
        statusCode: 404,
      });
    }
  }
  await db
    .insert(schema.contentPageCheckSkips)
    .values({
      checkId: args.checkId,
      documentId: args.documentId,
      placeKey: args.placeKey,
      textHash,
      skippedBy,
      createdAt: nowIso(),
    })
    .onConflictDoUpdate({
      target: [
        schema.contentPageCheckSkips.checkId,
        schema.contentPageCheckSkips.placeKey,
      ],
      set: { textHash, skippedBy, createdAt: nowIso() },
    });
  return { documentId: args.documentId, checkId: args.checkId, skipped: true };
}
