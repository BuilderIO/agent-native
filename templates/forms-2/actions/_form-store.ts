import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { z } from "zod";

import type { getDb } from "../server/db/index.js";
import { schema } from "../server/db/index.js";
import type { StoredAnswer } from "../server/db/schema.js";
import {
  formStatusSchema,
  type FormSettings,
  type FormSummary,
  type QuestionRow,
} from "../shared/form-contract.js";
import {
  deriveQuestions,
  isFormEmpty,
  ANSWER_TYPES,
  type Block,
} from "../shared/form-model/index.js";
import { firstRow, orgScope } from "./_access.js";

export type Db = ReturnType<typeof getDb>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

type FormRow = typeof schema.forms.$inferSelect;

export const newFormId = () =>
  crypto.randomUUID().replace(/-/g, "").slice(0, 12);

export const questionRowId = (formId: string, blockGroupId: string) =>
  `${formId}:${blockGroupId}`;

const questionTypeSchema = z.enum(ANSWER_TYPES);

/** Closed by hand, past its close time, or at its submissions limit. */
export function isClosedNow(
  form: Pick<FormRow, "isClosed"> & { settings: FormSettings },
  completedCount: number,
  now = Date.now(),
): boolean {
  if (form.isClosed) return true;
  const { closeAt, submissionsLimit } = form.settings;
  if (closeAt && Date.parse(closeAt) <= now) return true;
  return (
    typeof submissionsLimit === "number" && completedCount >= submissionsLimit
  );
}

export function acceptingResponses(
  form: Pick<FormRow, "isClosed" | "status"> & { settings: FormSettings },
  completedCount: number,
  now = Date.now(),
): boolean {
  return form.status === "published" && !isClosedNow(form, completedCount, now);
}

export function toFormSummary(
  row: FormRow,
  submissionCount: number,
): FormSummary {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    folderId: row.folderId,
    name: row.name,
    status: formStatusSchema.parse(row.status),
    isClosed: row.isClosed,
    hasDraftBlocks: row.draftBlocks != null,
    submissionCount,
    position: row.position,
    updatedAt: row.updatedAt,
  };
}

export async function completedCounts(
  db: Db | Tx,
  orgId: string | null,
  formIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (formIds.length === 0) return counts;
  const { submissions } = schema;
  const rows = await db
    .select({
      formId: submissions.formId,
      count: sql<number>`count(*)::int`,
    })
    .from(submissions)
    .where(
      and(
        orgScope(submissions, orgId),
        inArray(submissions.formId, formIds),
        eq(submissions.isCompleted, true),
        isNull(submissions.deletedAt),
      ),
    )
    .groupBy(submissions.formId);
  for (const row of rows) counts.set(row.formId, row.count);
  return counts;
}

export async function summarizeForms(
  db: Db | Tx,
  orgId: string | null,
  rows: FormRow[],
): Promise<FormSummary[]> {
  const counts = await completedCounts(
    db,
    orgId,
    rows.map((row) => row.id),
  );
  return rows.map((row) => toFormSummary(row, counts.get(row.id) ?? 0));
}

/** Keeps one question row per block group; groups that left the form are marked deleted. */
export async function materializeQuestions(
  tx: Db | Tx,
  orgId: string | null,
  formId: string,
  blocks: Block[],
): Promise<void> {
  const { questions } = schema;
  const derived = deriveQuestions(blocks);
  for (const question of derived) {
    const values = {
      type: question.type,
      title: question.title,
      options: question.options,
      matrixRows: question.rows,
      position: question.position,
      isDeleted: false,
    };
    await tx
      .insert(questions)
      .values({
        id: questionRowId(formId, question.id),
        orgId,
        formId,
        blockGroupId: question.id,
        ...values,
      })
      .onConflictDoUpdate({
        target: [questions.formId, questions.blockGroupId],
        set: values,
      });
  }
  const keep = derived.map((question) => question.id);
  await tx
    .update(questions)
    .set({ isDeleted: true })
    .where(
      and(
        orgScope(questions, orgId),
        eq(questions.formId, formId),
        keep.length ? notInArray(questions.blockGroupId, keep) : undefined,
      ),
    );
}

/** Live questions in form order, then deleted ones. */
export async function loadQuestions(
  db: Db | Tx,
  orgId: string | null,
  formId: string,
): Promise<QuestionRow[]> {
  const { questions } = schema;
  const rows = await db
    .select()
    .from(questions)
    .where(and(orgScope(questions, orgId), eq(questions.formId, formId)))
    .orderBy(questions.isDeleted, questions.position)
    .limit(1000);
  return rows.map((row) => ({
    id: row.blockGroupId,
    type: questionTypeSchema.parse(row.type),
    title: row.title,
    position: row.position,
    isDeleted: row.isDeleted,
    options: row.options,
    rows: row.matrixRows,
  }));
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Status a trashed form returns to: published stays published, else by content. */
export function restoredStatus(
  form: Pick<FormRow, "publishedAt" | "draftBlocks">,
): "published" | "draft" | "blank" {
  if (form.publishedAt) return "published";
  return form.draftBlocks && !isFormEmpty(form.draftBlocks) ? "draft" : "blank";
}

export type StoredAnswers = Record<string, StoredAnswer>;

export type SubmissionFilter = "all" | "completed" | "partial";

export function filterCondition(filter: SubmissionFilter) {
  const { submissions } = schema;
  if (filter === "completed") return eq(submissions.isCompleted, true);
  if (filter === "partial") return eq(submissions.isCompleted, false);
  return undefined;
}

/** Answers per submission, keyed by block group id. */
export async function loadAnswers(
  db: Db | Tx,
  orgId: string | null,
  submissionIds: string[],
): Promise<Map<string, StoredAnswers>> {
  const result = new Map<string, StoredAnswers>();
  if (submissionIds.length === 0) return result;
  const { responses, questions } = schema;
  const rows = await db
    .select({
      submissionId: responses.submissionId,
      blockGroupId: questions.blockGroupId,
      answer: responses.answer,
    })
    .from(responses)
    .innerJoin(questions, eq(questions.id, responses.questionId))
    .where(
      and(
        orgScope(responses, orgId),
        inArray(responses.submissionId, submissionIds),
      ),
    );
  for (const row of rows) {
    const answers = result.get(row.submissionId) ?? {};
    answers[row.blockGroupId] = row.answer;
    result.set(row.submissionId, answers);
  }
  return result;
}

export function toSubmissionRow(
  row: typeof schema.submissions.$inferSelect,
  answers: StoredAnswers | undefined,
) {
  return {
    id: row.id,
    formId: row.formId,
    isCompleted: row.isCompleted,
    submittedAt: row.submittedAt,
    answers: answers ?? {},
  };
}

export async function submissionCounts(
  db: Db | Tx,
  orgId: string | null,
  formId: string,
) {
  const { submissions } = schema;
  const row = firstRow(
    await db
      .select({
        completed: sql<number>`count(*) filter (where ${submissions.isCompleted})::int`,
        partial: sql<number>`count(*) filter (where not ${submissions.isCompleted})::int`,
      })
      .from(submissions)
      .where(
        and(
          orgScope(submissions, orgId),
          eq(submissions.formId, formId),
          isNull(submissions.deletedAt),
        ),
      ),
  );
  const completed = row?.completed ?? 0;
  const partial = row?.partial ?? 0;
  return { all: completed + partial, completed, partial };
}

/** Half-open [from, to) ISO bounds for an insights period, in UTC; null means unbounded. */
export function periodRange(
  period: string,
  now = new Date(),
): { from: string | null; to: string | null } {
  const day = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const hours = (n: number) =>
    new Date(now.getTime() - n * 3_600_000).toISOString();
  const months = (n: number) => {
    const d = new Date(now);
    d.setUTCMonth(d.getUTCMonth() - n);
    return d.toISOString();
  };
  switch (period) {
    case "today":
      return { from: new Date(day).toISOString(), to: null };
    case "yesterday":
      return {
        from: new Date(day - 86_400_000).toISOString(),
        to: new Date(day).toISOString(),
      };
    case "24h":
      return { from: hours(24), to: null };
    case "7d":
      return { from: hours(24 * 7), to: null };
    case "30d":
      return { from: hours(24 * 30), to: null };
    case "3m":
      return { from: months(3), to: null };
    case "6m":
      return { from: months(6), to: null };
    case "12m":
      return { from: months(12), to: null };
    default:
      return { from: null, to: null };
  }
}

/** A published, undeleted form a visitor may see, with its completed count. */
export async function findPublicForm(db: Db | Tx, formId: string) {
  const { forms, workspaces } = schema;
  const row = firstRow(
    await db
      .select({ form: forms, workspaceDeletedAt: workspaces.deletedAt })
      .from(forms)
      .innerJoin(workspaces, eq(workspaces.id, forms.workspaceId))
      .where(eq(forms.id, formId))
      .limit(1),
  );
  if (!row || row.form.status !== "published" || row.workspaceDeletedAt)
    return null;
  const counts = await completedCounts(db, row.form.orgId, [formId]);
  return { form: row.form, completed: counts.get(formId) ?? 0 };
}
