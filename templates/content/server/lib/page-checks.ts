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
  hasPageCheckQuestion,
  isFreshPageCheckResult,
  isRetryablePageCheckResult,
  PAGE_CHECK_LIMIT,
  PAGE_CHECK_SURE_SETTINGS,
  pageCheckAnswers,
  pageCheckHeadings,
  pageCheckPlaces,
  pageCheckWordingHash,
  readPageCheckSentence,
  type PageCheck,
  type PageCheckPart,
  type PageCheckPlace,
  type PageCheckProblem,
  type PageCheckQuestionInput,
  type PageCheckQuestionPart,
  type PageCheckResult,
  type PageCheckScope,
  type PageCheckSkip,
  type PageCheckSure,
  type PageCheckView,
} from "../../shared/page-checks.js";
import { getDb, schema } from "../db/index.js";
import { firstRow } from "./first-row.js";
import {
  askPageCheckQuestions,
  clearOldPageCheckUsage,
  eachAtOnce,
  PAGE_CHECK_RUN_BUDGET_MS,
  pageCheckDecider,
  pageCheckDeciderName,
  writePageCheckQuestions,
} from "./page-check-questions.js";

type CheckRow = typeof schema.contentPageChecks.$inferSelect;
type ResultRow = typeof schema.contentPageCheckResults.$inferSelect;

export type PageCheckScopeInput =
  | Exclude<PageCheckScope, { kind: "section" }>
  | (Omit<Extract<PageCheckScope, { kind: "section" }>, "headingId"> & {
      headingId?: string | null;
    });

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

async function savedBody(
  documentId: string,
  options: {
    editorSaved?: boolean | undefined;
    minRole: "commenter" | "editor";
  },
) {
  if (!options.editorSaved) {
    const access = await pageCheckAccess(documentId, options.minRole);
    await flushOpenDocumentEditorToSql({
      documentId,
      ownerEmail: (access.resource.ownerEmail as string | undefined) || null,
    });
  }
  const access = await pageCheckAccess(documentId, options.minRole);
  const markdown = (access.resource.content as string | null | undefined) ?? "";
  return {
    access,
    markdown,
    idsByPath: await bodyIdsByPath(documentId, markdown),
  };
}

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
    sure:
      PAGE_CHECK_SURE_SETTINGS.find((setting) => setting === row.sure) ??
      "balanced",
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
    skips: loaded.skips.map(({ placeKey, textHash }) => ({
      placeKey,
      textHash,
    })),
  };
}

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
      : 'Write what the text should keep, like "Under 120 words".',
    {
      errorCode: "PAGE_CHECK_UNREADABLE",
      statusCode: 400,
      details: { parts: reading.parts, tooManyParts: reading.tooManyParts },
    },
  );
}

function problemError(
  problem: PageCheckProblem,
  sentence: string,
): ActionContractError {
  switch (problem.kind) {
    case "unreadable":
      return unreadableSentence(sentence);
    case "vague":
      return new ActionContractError(
        `"${problem.text}" is too vague to answer the same way twice. Try something sharper, like "${problem.examples[0]}" or "${problem.examples[1]}".`,
        { errorCode: "PAGE_CHECK_VAGUE", statusCode: 400, details: problem },
      );
    case "unwritten":
      return new ActionContractError(
        "Content couldn't write a yes/no question for every part of this check. Try again, or pass each part's question.",
        {
          errorCode: "PAGE_CHECK_QUESTION_UNWRITTEN",
          statusCode: 503,
          details: problem,
        },
      );
    case "no_model":
      return new ActionContractError(
        "No decision model is ready to answer yes/no checks here. Counts of words, sentences and paragraphs still work.",
        { errorCode: "PAGE_CHECK_NO_MODEL", statusCode: 409 },
      );
  }
}

function checkNotFound(): ActionContractError {
  return new ActionContractError("That check doesn't exist.", {
    errorCode: "PAGE_CHECK_NOT_FOUND",
    statusCode: 404,
  });
}

function questionParts(parts: readonly PageCheckPart[]) {
  return parts.filter(
    (part): part is PageCheckQuestionPart => part.kind === "question",
  );
}

function firstQuestionPart(parts: readonly PageCheckPart[]) {
  return parts.find(
    (part): part is PageCheckQuestionPart => part.kind === "question",
  );
}

function questionsOf(
  parts: readonly PageCheckPart[],
): PageCheckQuestionInput[] {
  return questionParts(parts).map(({ text, question, passes }) => ({
    text,
    question,
    passes,
  }));
}

async function pageQuestionDecider(documentId: string) {
  const rows = await getDb()
    .select({ parts: schema.contentPageChecks.parts })
    .from(schema.contentPageChecks)
    .where(eq(schema.contentPageChecks.documentId, documentId));
  return firstQuestionPart(
    rows.flatMap((row) => parseJson<PageCheckPart[]>(row.parts, [])),
  )?.decider;
}

async function resolvePageCheckParts(args: {
  documentId: string;
  sentence: string;
  questions?: readonly PageCheckQuestionInput[] | undefined;
  current?: readonly PageCheckPart[] | undefined;
  ownerEmail: string;
}): Promise<
  | { parts: PageCheckPart[]; problem: null }
  | { parts: null; problem: PageCheckProblem }
> {
  const reading = readPageCheckSentence(args.sentence);
  if (reading.tooManyParts || reading.parts.length === 0) {
    return {
      parts: null,
      problem: { kind: "unreadable", tooManyParts: reading.tooManyParts },
    };
  }
  const unread = reading.parts.flatMap((part) =>
    part.kind === "unread" ? [part.text] : [],
  );
  const decider =
    unread.length === 0
      ? null
      : await pageCheckDecider(
          args.ownerEmail,
          firstQuestionPart(args.current ?? [])?.decider ??
            (await pageQuestionDecider(args.documentId)),
        );
  if (unread.length > 0 && !decider) {
    return { parts: null, problem: { kind: "no_model" } };
  }
  const given = new Map(
    (args.questions ?? []).map((question) => [question.text.trim(), question]),
  );
  const written = await writePageCheckQuestions(
    unread.filter((text) => !given.has(text)),
  );
  if (written.status === "vague") {
    return {
      parts: null,
      problem: {
        kind: "vague",
        text: written.text,
        examples: written.examples,
      },
    };
  }
  if (written.status === "ok") {
    for (const question of written.questions) {
      given.set(question.text, question);
    }
  }
  const parts: PageCheckPart[] = [];
  for (const part of reading.parts) {
    const question = part.kind === "unread" ? given.get(part.text) : undefined;
    if (part.kind !== "unread") parts.push(part);
    else if (question && decider) {
      parts.push({
        kind: "question",
        text: part.text,
        question: question.question.trim(),
        passes: question.passes,
        decider,
      });
    }
  }
  if (parts.length < reading.parts.length) {
    return {
      parts: null,
      problem: {
        kind: "unwritten",
        texts: unread.filter((text) => !given.has(text)),
      },
    };
  }
  return { parts, problem: null };
}

async function resolvedPartsOrThrow(
  args: Parameters<typeof resolvePageCheckParts>[0],
) {
  const resolved = await resolvePageCheckParts(args);
  if (!resolved.parts) throw problemError(resolved.problem, args.sentence);
  return resolved.parts;
}

function partsDecider(parts: readonly PageCheckPart[]) {
  const decider = firstQuestionPart(parts)?.decider;
  return decider ? pageCheckDeciderName(decider) : null;
}

async function checkPlaces(input: {
  ownerEmail: string;
  documentId: string;
  parts: readonly PageCheckPart[];
  sure: PageCheckSure;
  places: readonly PageCheckPlace[];
  deadline: number;
  found: (
    place: PageCheckPlace,
    found: ReturnType<typeof checkPageCheckPlace>,
  ) => Promise<void> | void;
}) {
  const asks = hasPageCheckQuestion(input.parts);
  await eachAtOnce(
    input.places,
    asks ? input.deadline : Number.POSITIVE_INFINITY,
    async (place) => {
      const asked = asks
        ? await askPageCheckQuestions({ ...input, place })
        : undefined;
      await input.found(place, checkPageCheckPlace(input.parts, place, asked));
    },
  );
}

export async function tryPageCheck(args: {
  documentId: string;
  sentence: string;
  scope: PageCheckScopeInput;
  questions?: readonly PageCheckQuestionInput[] | undefined;
  sure?: PageCheckSure | undefined;
}) {
  const ownerEmail = currentUserEmail();
  const { markdown, idsByPath } = await savedBody(args.documentId, {
    minRole: "editor",
  });
  const reading = readPageCheckSentence(args.sentence);
  const resolved = await resolvePageCheckParts({ ...args, ownerEmail });
  if (!resolved.parts) {
    return {
      reading,
      parts: null,
      answers: null,
      problem: resolved.problem,
      decider: null,
    };
  }
  const parts = resolved.parts;
  const sure = args.sure ?? "balanced";
  const scope = resolveScope(args.scope, markdown, idsByPath);
  const wordingHash = pageCheckWordingHash({ parts, scope });
  const places = pageCheckPlaces(markdown, scope, idsByPath);
  const results: PageCheckResult[] = [];
  await checkPlaces({
    ownerEmail,
    documentId: args.documentId,
    parts,
    sure,
    places: places.status === "ok" ? places.places : [],
    deadline: Date.now() + PAGE_CHECK_RUN_BUDGET_MS,
    found: (place, found) => {
      results.push({
        placeKey: place.key,
        wordingHash,
        textHash: place.textHash,
        checkedBy: "",
        checkedAt: "",
        ...found,
      });
    },
  });
  return {
    reading,
    parts,
    answers: pageCheckAnswers({ wordingHash, sure }, places, results, []),
    problem: null,
    decider: partsDecider(parts),
  };
}

async function checkStalePlaces(args: {
  documentId: string;
  markdown: string;
  idsByPath: Record<string, string>;
  checkIds?: string[] | undefined;
  checkedBy: string;
  retry: boolean;
}) {
  const db = getDb();
  const loaded = await loadPageChecks(args.documentId, args.checkIds);
  const deadline = Date.now() + PAGE_CHECK_RUN_BUDGET_MS;
  let clearedUsage = false;
  for (const { check, results } of loaded) {
    if (check.paused) continue;
    const places = pageCheckPlaces(args.markdown, check.scope, args.idsByPath);
    if (places.status !== "ok") continue;
    const resultsByKey = new Map(
      results.map((result) => [result.placeKey, result]),
    );
    const stale = places.places.filter((place) => {
      const result = resultsByKey.get(place.key);
      return (
        !isFreshPageCheckResult(result, check, place) ||
        (args.retry &&
          result !== undefined &&
          isRetryablePageCheckResult(result))
      );
    });
    if (
      !clearedUsage &&
      stale.length > 0 &&
      hasPageCheckQuestion(check.parts)
    ) {
      clearedUsage = true;
      await clearOldPageCheckUsage(args.documentId);
    }
    const checkedAt = nowIso();
    await checkPlaces({
      ownerEmail: args.checkedBy,
      documentId: args.documentId,
      parts: check.parts,
      sure: check.sure,
      places: stale,
      deadline,
      found: async (place, found) => {
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
      },
    });
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
  await checkStalePlaces({
    ...args,
    markdown,
    idsByPath,
    checkedBy,
    retry: !args.editorSaved,
  });
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
  questions?: readonly PageCheckQuestionInput[] | undefined;
  sure?: PageCheckSure | undefined;
}) {
  const createdBy = currentUserEmail();
  const sentence = args.sentence.trim();
  if (readPageCheckSentence(sentence).tooManyParts) {
    throw unreadableSentence(sentence);
  }
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
  const parts = await resolvedPartsOrThrow({
    documentId: args.documentId,
    sentence,
    questions: args.questions,
    ownerEmail: createdBy,
  });
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
    sure: args.sure ?? "balanced",
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
  questions?: readonly PageCheckQuestionInput[] | undefined;
  sure?: PageCheckSure | undefined;
  paused?: boolean;
}) {
  const ownerEmail = currentUserEmail();
  const { markdown, idsByPath } = await savedBody(args.documentId, {
    minRole: "editor",
  });
  const row = await loadCheckRow(args.documentId, args.checkId);
  const current = checkFromRow(row);
  const sentence = args.sentence?.trim() ?? current.sentence;
  const parts =
    args.sentence === undefined && args.questions === undefined
      ? current.parts
      : await resolvedPartsOrThrow({
          documentId: args.documentId,
          sentence,
          questions: args.questions ?? questionsOf(current.parts),
          current: current.parts,
          ownerEmail,
        });
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
      sure: args.sure ?? current.sure,
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
  return {
    documentId: args.documentId,
    checkId: args.checkId,
    deleted: true as const,
  };
}

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
    return {
      documentId: args.documentId,
      checkId: args.checkId,
      skipped: false,
    };
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
