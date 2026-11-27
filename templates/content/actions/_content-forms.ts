import { randomBytes } from "node:crypto";

import {
  fail,
  isActionContractError,
  type ActionRunContext,
} from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { isOrgMember } from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNull } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { documentAttributionActor } from "../server/lib/document-attribution.js";
import { firstRow } from "../server/lib/first-row.js";
import type { ContentDatabaseView } from "../shared/api.js";
import {
  CONTENT_FORM_AUDIENCES,
  contentFormLinkPath,
  parseContentFormLink,
  type ContentFormAnswerEntry,
  type ContentFormAudience,
  type ContentFormProblem,
  type ContentFormRead,
  type ContentFormReceipt,
  type ContentFormRefusal,
  type ContentFormRefusalCode,
  type ContentFormSender,
  type ContentFormSettings,
  type ContentFormSubmitResult,
} from "../shared/content-forms.js";
import { FORM_TITLE_QUESTION_KEY } from "../shared/form-question-block.js";
import { lockContentDatabaseMutation } from "./_content-database-mutation-lock.js";
import {
  CONTENT_FORM_FLOOD_WINDOW_MS,
  CONTENT_FORM_FORM_LIMIT,
  CONTENT_FORM_SOURCE_LIMIT,
  contentFormSourceKey,
  takeContentFormFloodSlot,
} from "./_content-form-flood.js";
import {
  assertContentFormUnchanged,
  contentFormAnswerSchema,
  contentFormReceiptAnswers,
  linkContentFormQuestions,
  loadContentFormQuestions,
  publicContentFormQuestion,
  readContentFormRow,
  type AnswerableContentFormQuestion,
  type ContentFormCanvas,
  type ContentFormIdentity,
  type ContentFormRow,
} from "./_content-form-questions.js";
import {
  assertNoContentFormSubmission,
  assertSameContentFormSubmission,
  contentFormAnswersDigest,
  contentFormReceipt,
  ContentFormSubmissionExists,
  countRecentContentFormSubmissions,
  deleteContentFormDraftRow,
  insertContentFormSubmission,
  listSenderContentFormSubmissions,
  sortedContentFormEntries,
  type ContentFormSubmissionRow,
} from "./_content-form-receipts.js";
import { assertCollectionAcceptsNewRows } from "./_document-source.js";
import { parseDatabaseViewConfig } from "./_property-utils.js";
import {
  prepareCollectionFormRecord,
  propertyDefinitionFingerprint,
  writeCollectionFormRecord,
  type CollectionFormRecordCreated,
  type PropertyDefinitionRow,
} from "./submit-content-database-form.js";

type ContentDb = ReturnType<typeof getDb>;
type ContentDatabaseRow = typeof schema.contentDatabases.$inferSelect;

const REFUSAL_STATUS: Record<ContentFormRefusalCode, number> = {
  form_not_found: 404,
  form_unavailable: 409,
  form_closed: 403,
  sign_in_required: 401,
  organization_only: 403,
  already_answered: 409,
  too_many_submissions: 429,
  idempotency_conflict: 409,
  form_changed: 409,
  drafts_unavailable: 403,
};

const SENT_RECEIPTS_LIMIT = 20;
const TITLE_MAX_LENGTH = 500;

export function refuseContentForm(
  refusal: ContentFormRefusal,
  details?: Record<string, unknown>,
): never {
  return fail(refusal.message, {
    errorCode: refusal.code,
    statusCode: REFUSAL_STATUS[refusal.code],
    ...(details ? { details } : {}),
  });
}

const FORM_CLOSED: ContentFormRefusal = {
  code: "form_closed",
  message: "This form isn't accepting answers right now.",
};

function alreadyAnswered(submission: ContentFormSubmissionRow) {
  return {
    code: "already_answered",
    message: `You already answered this form on ${submission.createdAt.slice(0, 10)} (receipt ${submission.id}), and it takes one answer per person. What you sent is listed with the form.`,
  } satisfies ContentFormRefusal;
}

export function newContentFormLinkToken(): string {
  return randomBytes(24).toString("base64url");
}

function parseContentFormAudience(value: string): ContentFormAudience {
  const audience = CONTENT_FORM_AUDIENCES.find(
    (candidate) => candidate === value,
  );
  if (!audience) {
    // guard:allow-bare-error — invariant: configureContentForm writes only known audiences
    throw new Error(`Form audience "${value}" is not one Content knows.`);
  }
  return audience;
}

export function contentFormSettings(
  form: ContentFormIdentity,
  row: ContentFormRow | undefined,
): ContentFormSettings {
  if (!row) {
    return {
      ...form,
      configured: false,
      audience: "signed_in",
      oneAnswerPerPerson: false,
      acceptingAnswers: true,
      thankYouMessage: "",
      canvasDocumentId: null,
      link: null,
    };
  }
  return {
    ...form,
    configured: true,
    audience: parseContentFormAudience(row.audience),
    oneAnswerPerPerson: row.oneAnswerPerPerson === 1,
    acceptingAnswers: row.acceptingAnswers === 1,
    thankYouMessage: row.thankYouMessage,
    canvasDocumentId: row.canvasDocumentId,
    link: { token: row.linkToken, path: contentFormLinkPath(row.linkToken) },
  };
}

function invalidSettings(message: string): never {
  return fail(message, { errorCode: "invalid_form_settings", statusCode: 400 });
}

export async function loadEditableContentForm(form: ContentFormIdentity) {
  const database = firstRow(
    await getDb()
      .select()
      .from(schema.contentDatabases)
      .where(
        and(
          eq(schema.contentDatabases.id, form.databaseId),
          isNull(schema.contentDatabases.deletedAt),
        ),
      )
      .limit(1),
  );
  if (!database) {
    fail(`Collection "${form.databaseId}" not found.`, {
      errorCode: "collection_not_found",
      statusCode: 404,
    });
  }
  await assertAccess("document", database.documentId, "editor");
  const view = parseDatabaseViewConfig(database.viewConfigJson).views.find(
    (candidate) => candidate.id === form.viewId,
  );
  if (view?.type !== "form") {
    fail(`View "${form.viewId}" is not a form view of this collection.`, {
      errorCode: "not_a_form_view",
      statusCode: 400,
    });
  }
  return { database, view };
}

async function assertContentFormCanvas(
  database: ContentDatabaseRow,
  canvasDocumentId: string,
) {
  await assertAccess("document", canvasDocumentId, "editor");
  const db = getDb();
  const canvas = firstRow(
    await db
      .select({
        parentId: schema.documents.parentId,
        spaceId: schema.documents.spaceId,
        ownerEmail: schema.documents.ownerEmail,
        trashedAt: schema.documents.trashedAt,
      })
      .from(schema.documents)
      .where(eq(schema.documents.id, canvasDocumentId))
      .limit(1),
  );
  if (
    !canvas ||
    canvas.trashedAt !== null ||
    canvas.parentId !== database.documentId ||
    canvas.spaceId !== database.spaceId ||
    canvas.ownerEmail !== database.ownerEmail
  ) {
    invalidSettings("A form's page must be a page inside its collection.");
  }
  const row = firstRow(
    await db
      .select({ id: schema.contentDatabaseItems.id })
      .from(schema.contentDatabaseItems)
      .where(
        and(
          eq(schema.contentDatabaseItems.databaseId, database.id),
          eq(schema.contentDatabaseItems.documentId, canvasDocumentId),
        ),
      )
      .limit(1),
  );
  if (row) invalidSettings("A collection row can't be a form's page.");
}

export interface ConfigureContentFormInput extends ContentFormIdentity {
  audience?: ContentFormAudience | undefined;
  oneAnswerPerPerson?: boolean | undefined;
  acceptingAnswers?: boolean | undefined;
  thankYouMessage?: string | undefined;
  canvasDocumentId?: string | null | undefined;
  rotateLink?: boolean | undefined;
}

export async function configureContentForm(
  input: ConfigureContentFormInput,
  ctx?: ActionRunContext,
): Promise<ContentFormSettings> {
  const { database, view } = await loadEditableContentForm(input);
  const form = { databaseId: database.id, viewId: view.id };
  if (input.canvasDocumentId) {
    await assertContentFormCanvas(database, input.canvasDocumentId);
  }
  const actor = documentAttributionActor(ctx);
  await getDb().transaction(async (tx) => {
    const lockedDb = tx as unknown as ContentDb;
    await lockContentDatabaseMutation(lockedDb, database.id);
    const current = contentFormSettings(
      form,
      await readContentFormRow(lockedDb, form),
    );
    const audience = input.audience ?? current.audience;
    const oneAnswerPerPerson =
      input.oneAnswerPerPerson ?? current.oneAnswerPerPerson;
    if (oneAnswerPerPerson && audience === "anonymous") {
      invalidSettings(
        "One answer per person needs people to sign in, so an anonymous form can't use it.",
      );
    }
    if (audience === "organization" && !database.orgId) {
      invalidSettings(
        "This collection doesn't belong to an organization, so its form can't be limited to one.",
      );
    }
    const now = new Date().toISOString();
    const values = {
      audience,
      oneAnswerPerPerson: oneAnswerPerPerson ? 1 : 0,
      acceptingAnswers:
        (input.acceptingAnswers ?? current.acceptingAnswers) ? 1 : 0,
      thankYouMessage: input.thankYouMessage ?? current.thankYouMessage,
      canvasDocumentId:
        input.canvasDocumentId === undefined
          ? current.canvasDocumentId
          : input.canvasDocumentId,
      updatedBy: actor,
      updatedAt: now,
    };
    if (!current.link) {
      await tx.insert(schema.contentForms).values({
        ...form,
        ...values,
        linkToken: newContentFormLinkToken(),
        createdAt: now,
      });
      return;
    }
    await tx
      .update(schema.contentForms)
      .set({
        ...values,
        ...(input.rotateLink ? { linkToken: newContentFormLinkToken() } : {}),
      })
      .where(
        and(
          eq(schema.contentForms.databaseId, form.databaseId),
          eq(schema.contentForms.viewId, form.viewId),
        ),
      );
  });
  return contentFormSettings(form, await readContentFormRow(getDb(), form));
}

export async function getContentFormSettings(
  form: ContentFormIdentity,
): Promise<ContentFormSettings> {
  const { database, view } = await loadEditableContentForm(form);
  const identity = { databaseId: database.id, viewId: view.id };
  return contentFormSettings(
    identity,
    await readContentFormRow(getDb(), identity),
  );
}

export interface LinkedContentForm {
  identity: ContentFormIdentity;
  settings: ContentFormRow;
  audience: ContentFormAudience;
  database: ContentDatabaseRow;
  databaseDocument: Pick<
    typeof schema.documents.$inferSelect,
    "hideFromSearch" | "visibility"
  >;
  view: ContentDatabaseView;
  definitions: PropertyDefinitionRow[];
}

const FORM_UNAVAILABLE: ContentFormRefusal = {
  code: "form_unavailable",
  message: "This form is no longer available.",
};

export async function resolveLinkedContentForm(
  link: string,
): Promise<LinkedContentForm> {
  const token = parseContentFormLink(link);
  const db = getDb();
  const settings = token
    ? firstRow(
        await db
          .select()
          .from(schema.contentForms)
          .where(eq(schema.contentForms.linkToken, token))
          .limit(1),
      )
    : undefined;
  if (!settings) {
    refuseContentForm({
      code: "form_not_found",
      message:
        "This form link doesn't work. Ask whoever shared it for a new link.",
    });
  }
  const database = firstRow(
    await db
      .select()
      .from(schema.contentDatabases)
      .where(
        and(
          eq(schema.contentDatabases.id, settings.databaseId),
          isNull(schema.contentDatabases.deletedAt),
        ),
      )
      .limit(1),
  );
  if (!database) refuseContentForm(FORM_UNAVAILABLE);
  const databaseDocument = firstRow(
    await db
      .select({
        hideFromSearch: schema.documents.hideFromSearch,
        visibility: schema.documents.visibility,
        trashedAt: schema.documents.trashedAt,
      })
      .from(schema.documents)
      .where(eq(schema.documents.id, database.documentId))
      .limit(1),
  );
  const view = parseDatabaseViewConfig(database.viewConfigJson).views.find(
    (candidate) => candidate.id === settings.viewId,
  );
  if (
    !databaseDocument ||
    databaseDocument.trashedAt !== null ||
    view?.type !== "form"
  ) {
    refuseContentForm(FORM_UNAVAILABLE);
  }
  const definitions = await db
    .select()
    .from(schema.documentPropertyDefinitions)
    .where(
      and(
        eq(schema.documentPropertyDefinitions.databaseId, database.id),
        eq(schema.documentPropertyDefinitions.ownerEmail, database.ownerEmail),
      ),
    )
    .orderBy(schema.documentPropertyDefinitions.position);
  return {
    identity: { databaseId: database.id, viewId: view.id },
    settings,
    audience: parseContentFormAudience(settings.audience),
    database,
    databaseDocument,
    view,
    definitions,
  };
}

export async function contentFormSender(
  linked: LinkedContentForm,
  ctx?: ActionRunContext,
): Promise<{ sender: ContentFormSender; refusal: ContentFormRefusal | null }> {
  if (linked.audience === "anonymous") {
    return { sender: { kind: "anonymous" }, refusal: null };
  }
  const email = documentAttributionActor(ctx);
  if (!email) {
    return {
      sender: { kind: "anonymous" },
      refusal: {
        code: "sign_in_required",
        message: "Sign in to answer this form.",
      },
    };
  }
  const sender: ContentFormSender = { kind: "signed_in", email };
  if (
    linked.audience === "organization" &&
    !(
      linked.database.orgId && (await isOrgMember(linked.database.orgId, email))
    )
  ) {
    return {
      sender,
      refusal: {
        code: "organization_only",
        message:
          "Only members of the organization this form belongs to can answer it.",
      },
    };
  }
  return { sender, refusal: null };
}

async function linkFormQuestions(linked: LinkedContentForm): Promise<{
  questions: AnswerableContentFormQuestion[];
  canvas: ContentFormCanvas | null;
}> {
  const loaded = await loadContentFormQuestions({
    database: linked.database,
    view: linked.view,
    definitions: linked.definitions,
    settings: linked.settings,
    channel: "link",
  });
  return {
    questions: linkContentFormQuestions(loaded.questions),
    canvas: loaded.canvas,
  };
}

function contentFormTitle(
  linked: LinkedContentForm,
  canvas: ContentFormCanvas | null,
) {
  return canvas?.title.trim() || linked.view.name;
}

export async function readContentFormByLink(
  link: string,
  ctx?: ActionRunContext,
): Promise<ContentFormRead> {
  const linked = await resolveLinkedContentForm(link);
  const { sender, refusal } = await contentFormSender(linked, ctx);
  if (refusal) refuseContentForm(refusal);
  const { questions, canvas } = await linkFormQuestions(linked);
  const sent =
    sender.kind === "signed_in"
      ? await listSenderContentFormSubmissions(
          getDb(),
          linked.identity,
          sender.email,
          SENT_RECEIPTS_LIMIT,
        )
      : [];
  const latest = firstRow(sent);
  const answeringRefusal =
    linked.settings.acceptingAnswers !== 1
      ? FORM_CLOSED
      : linked.settings.oneAnswerPerPerson === 1 && latest
        ? alreadyAnswered(latest)
        : null;
  return {
    title: contentFormTitle(linked, canvas),
    canvas: canvas?.content ?? null,
    questions: questions.map(publicContentFormQuestion),
    answerSchema: contentFormAnswerSchema(questions),
    answering: {
      as: linked.audience === "anonymous" ? "anonymous" : "signed_in",
      canSubmit: answeringRefusal === null,
      refusal: answeringRefusal,
    },
    sent: sent.map((submission) => contentFormReceipt(submission)),
  };
}

function submittedMessage(receipt: ContentFormReceipt) {
  const thanks =
    receipt.thankYouMessage.trim() || "Thanks, your answers were sent.";
  const as =
    receipt.sender.kind === "anonymous"
      ? "anonymously"
      : `as ${receipt.sender.email}`;
  return `${thanks} Recorded ${as} (receipt ${receipt.receiptId}).`;
}

function replayedSubmission(
  submission: ContentFormSubmissionRow,
  attempt: { sender: ContentFormSender; digest: string },
): ContentFormSubmitResult {
  const receipt = contentFormReceipt(
    submission,
    assertSameContentFormSubmission(submission, attempt),
  );
  return {
    outcome: "submitted",
    replayed: true,
    message: `These answers were already sent with this idempotencyKey, so nothing new was saved. ${submittedMessage(receipt)}`,
    receipt,
  };
}

async function refuseFlood(
  linked: LinkedContentForm,
  idempotencyKey: string,
  message: string,
  retryAfterSeconds: number,
): Promise<never> {
  await assertNoContentFormSubmission(getDb(), linked.identity, idempotencyKey);
  return refuseContentForm(
    { code: "too_many_submissions", message },
    { retryAfterSeconds },
  );
}

async function assertFloodAllows(
  linked: LinkedContentForm,
  ctx: ActionRunContext | undefined,
  idempotencyKey: string,
) {
  const sourceKey = contentFormSourceKey({
    email: documentAttributionActor(ctx),
    headers: ctx?.requestHeaders,
  });
  const slot = takeContentFormFloodSlot([
    ...(sourceKey
      ? [{ key: `source:${sourceKey}`, limit: CONTENT_FORM_SOURCE_LIMIT }]
      : []),
    {
      key: `form:${linked.identity.databaseId}:${linked.identity.viewId}`,
      limit: CONTENT_FORM_FORM_LIMIT,
    },
  ]);
  if (!slot.ok) {
    await refuseFlood(
      linked,
      idempotencyKey,
      `Too many answers were sent ${slot.key.startsWith("source:") ? "from here" : "to this form"} just now. Try again in ${slot.retryAfterSeconds} seconds.`,
      slot.retryAfterSeconds,
    );
  }
  const windowSeconds = CONTENT_FORM_FLOOD_WINDOW_MS / 1000;
  const recent = await countRecentContentFormSubmissions(
    getDb(),
    linked.identity,
    new Date(Date.now() - CONTENT_FORM_FLOOD_WINDOW_MS).toISOString(),
  );
  if (recent >= CONTENT_FORM_FORM_LIMIT) {
    await refuseFlood(
      linked,
      idempotencyKey,
      `Too many answers were sent to this form just now. Try again in ${windowSeconds} seconds.`,
      windowSeconds,
    );
  }
}

async function assertNotAnsweredYet(
  db: ContentDb,
  linked: LinkedContentForm,
  sender: ContentFormSender,
  idempotencyKey: string,
) {
  if (linked.settings.oneAnswerPerPerson !== 1 || sender.kind !== "signed_in") {
    return;
  }
  const prior = firstRow(
    await listSenderContentFormSubmissions(
      db,
      linked.identity,
      sender.email,
      1,
    ),
  );
  if (!prior) return;
  if (prior.idempotencyKey === idempotencyKey) {
    throw new ContentFormSubmissionExists(prior);
  }
  refuseContentForm(alreadyAnswered(prior), {
    receipt: contentFormReceipt(prior),
  });
}

async function assertLinkedCollectionOpen(
  linked: LinkedContentForm,
  db: ContentDb,
) {
  try {
    await assertCollectionAcceptsNewRows(linked.database.id, db);
  } catch (error) {
    if (!isActionContractError(error)) throw error;
    refuseContentForm(FORM_CLOSED);
  }
}

function splitTitleAnswer(
  questions: AnswerableContentFormQuestion[],
  entries: ReadonlyArray<readonly [string, unknown]>,
) {
  const titleQuestion = questions.find(
    (question) => question.key === FORM_TITLE_QUESTION_KEY,
  );
  const problems: ContentFormProblem[] = [];
  const propertyEntries: Array<readonly [string, unknown]> = [];
  let title: string | undefined;
  for (const entry of entries) {
    const [key, value] = entry;
    if (key.trim().toLocaleLowerCase() !== FORM_TITLE_QUESTION_KEY) {
      propertyEntries.push(entry);
      continue;
    }
    if (!titleQuestion) {
      problems.push({
        question: key,
        wording: null,
        message: `This form has no question "${key}".`,
      });
      continue;
    }
    const problem = (message: string) => {
      problems.push({
        question: titleQuestion.key,
        wording: titleQuestion.wording,
        message,
      });
    };
    if (title !== undefined) {
      problem(`"${titleQuestion.wording}" was answered more than once.`);
    } else if (value === null || value === undefined) {
      title = "";
    } else if (typeof value !== "string") {
      problem(`"${titleQuestion.wording}" needs text.`);
      title = "";
    } else if (value.trim().length > TITLE_MAX_LENGTH) {
      problem(
        `"${titleQuestion.wording}" can be at most ${TITLE_MAX_LENGTH} characters.`,
      );
      title = "";
    } else {
      title = value;
    }
  }
  return { title, propertyEntries, problems };
}

function needsChanges(
  questions: AnswerableContentFormQuestion[],
  problems: ContentFormProblem[],
): ContentFormSubmitResult {
  const order = new Map(
    questions.map((question, index) => [question.key, index]),
  );
  const sorted = [...problems].sort(
    (left, right) =>
      (order.get(left.question) ?? questions.length) -
      (order.get(right.question) ?? questions.length),
  );
  return {
    outcome: "needs_changes",
    message: [
      "Nothing was saved. Fix these answers, then send all of them again with the same idempotencyKey:",
      ...sorted.map(
        (problem) =>
          `- ${problem.wording ?? problem.question}: ${problem.message}`,
      ),
    ].join("\n"),
    problems: sorted,
  };
}

export async function submitContentFormByLink(
  input: {
    link: string;
    idempotencyKey: string;
    answers: ContentFormAnswerEntry[];
  },
  ctx?: ActionRunContext,
): Promise<ContentFormSubmitResult> {
  const linked = await resolveLinkedContentForm(input.link);
  const { sender, refusal } = await contentFormSender(linked, ctx);
  if (refusal) refuseContentForm(refusal);
  const entries = input.answers.map(
    ({ question, value }) => [question, value] as const,
  );
  const attempt = {
    sender,
    digest: contentFormAnswersDigest(sortedContentFormEntries(entries)),
  };
  try {
    return await submitNewContentFormAnswers(
      linked,
      { ...attempt, entries, idempotencyKey: input.idempotencyKey },
      ctx,
    );
  } catch (error) {
    if (error instanceof ContentFormSubmissionExists) {
      return replayedSubmission(error.submission, attempt);
    }
    throw error;
  }
}

async function submitNewContentFormAnswers(
  linked: LinkedContentForm,
  attempt: {
    sender: ContentFormSender;
    digest: string;
    entries: ReadonlyArray<readonly [string, unknown]>;
    idempotencyKey: string;
  },
  ctx: ActionRunContext | undefined,
): Promise<ContentFormSubmitResult> {
  const { sender, idempotencyKey } = attempt;
  const db = getDb();
  await assertNoContentFormSubmission(db, linked.identity, idempotencyKey);
  if (linked.settings.acceptingAnswers !== 1) refuseContentForm(FORM_CLOSED);
  await assertFloodAllows(linked, ctx, idempotencyKey);
  await assertNotAnsweredYet(db, linked, sender, idempotencyKey);
  await assertLinkedCollectionOpen(linked, db);

  const { questions, canvas } = await linkFormQuestions(linked);
  const split = splitTitleAnswer(questions, attempt.entries);
  const prepared = await prepareCollectionFormRecord({
    definitions: linked.definitions,
    questions,
    title: split.title,
    entries: split.propertyEntries,
    scope: "form",
    ctx,
  });
  if (!prepared.ok || split.problems.length > 0) {
    const titleProblems = new Set(
      split.problems.map((problem) => problem.question),
    );
    return needsChanges(questions, [
      ...split.problems,
      ...(prepared.ok
        ? []
        : prepared.problems.filter(
            (problem) => !titleProblems.has(problem.question),
          )),
    ]);
  }

  const { record } = prepared;
  const { database } = linked;
  let created: CollectionFormRecordCreated & {
    inserted: ContentFormSubmissionRow;
  };
  try {
    created = await runWithRequestContext(
      {
        userEmail: database.ownerEmail,
        ...(database.orgId ? { orgId: database.orgId } : {}),
      },
      async () => {
        const written = await writeCollectionFormRecord({
          database,
          databaseDocument: linked.databaseDocument,
          definitionsFingerprint: propertyDefinitionFingerprint(
            linked.definitions,
          ),
          record,
          createdBy: sender.kind === "signed_in" ? sender.email : null,
          shareCreatedBy: database.ownerEmail,
          privateMediaActor: false,
          assertNotSubmitted: (tx) =>
            assertNoContentFormSubmission(tx, linked.identity, idempotencyKey),
          verifyLocked: async (tx) => {
            await assertContentFormUnchanged(tx, linked.identity, {
              settings: linked.settings,
              canvas,
            });
            await assertNotAnsweredYet(tx, linked, sender, idempotencyKey);
            await assertLinkedCollectionOpen(linked, tx);
          },
          afterInsert: async (tx, inserted) => {
            const submission = await insertContentFormSubmission(tx, {
              form: linked.identity,
              created: inserted,
              channel: "link",
              sender,
              idempotencyKey,
              digest: attempt.digest,
              receipt: {
                formTitle: contentFormTitle(linked, canvas),
                answers: contentFormReceiptAnswers(questions, record),
                thankYouMessage: linked.settings.thankYouMessage,
                submittedProperties: record.submittedProperties,
                submittedContent: record.documentContent !== "",
              },
            });
            if (sender.kind === "signed_in") {
              await deleteContentFormDraftRow(
                tx,
                linked.identity,
                sender.email,
              );
            }
            return submission;
          },
        });
        await writeAppState("refresh-signal", { ts: Date.now() });
        return written;
      },
    );
  } catch (error) {
    const takenKey = naturalKeyQuestion(error, questions);
    if (!takenKey) throw error;
    return needsChanges(questions, [takenKey]);
  }
  const receipt = contentFormReceipt(created.inserted);
  return {
    outcome: "submitted",
    replayed: false,
    message: submittedMessage(receipt),
    receipt,
  };
}

function naturalKeyQuestion(
  error: unknown,
  questions: AnswerableContentFormQuestion[],
): ContentFormProblem | null {
  if (
    !isActionContractError(error) ||
    error.errorCode !== "NATURAL_KEY_CONFLICT"
  ) {
    return null;
  }
  const question = questions.find(
    (candidate) => candidate.key === error.details?.propertyId,
  );
  return question
    ? {
        question: question.key,
        wording: question.wording,
        message: error.message,
      }
    : null;
}
