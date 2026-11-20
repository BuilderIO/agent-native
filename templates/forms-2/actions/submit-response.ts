import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { submitResultSchema } from "../shared/form-contract.js";
import {
  answersSchema,
  validateSubmission,
} from "../shared/form-model/index.js";
import { firstRow, formsErrors, nowIso, orgScope } from "./_access.js";
import {
  dedupeKeyFor,
  ipHashFor,
  isDuplicateViolation,
  passwordGate,
} from "./_collection.js";
import {
  findPublicForm,
  isClosedNow,
  loadQuestions,
  questionRowId,
} from "./_form-store.js";
import { sendSubmissionEmails } from "./_notify.js";
import { checkEmailVerification } from "./_verification.js";

export default defineAction({
  description:
    "Submit a respondent's answers to a published form; no sign-in needed. Validates against the published blocks, rejects closed or unpublished forms, and is safe to retry with the same sessionId.",
  schema: z.object({
    formId: z.string().min(1).max(64).describe("Form id"),
    sessionId: z
      .string()
      .min(8)
      .max(128)
      .describe("Respondent browser session id; the idempotency key"),
    respondentId: z
      .string()
      .min(8)
      .max(128)
      .describe("Anonymous respondent id kept in the browser"),
    answers: answersSchema.describe(
      "Answers keyed by question id (block group uuid)",
    ),
    password: z
      .string()
      .max(200)
      .optional()
      .describe("Required when the form is password protected"),
    isCompleted: z
      .boolean()
      .default(true)
      .describe(
        "false saves a partial submission; only allowed when the form enables partial submissions",
      ),
    verificationCode: z
      .string()
      .max(20)
      .optional()
      .describe(
        "The 6-digit code mailed for an email question that requires verification; without it a code is sent and the result is reason verify",
      ),
  }),
  outputSchema: submitResultSchema,
  errors: formsErrors,
  requiresAuth: false,
  run: async ({
    formId,
    sessionId,
    respondentId,
    answers,
    password,
    isCompleted,
    verificationCode,
  }) => {
    const db = getDb();
    const found = await findPublicForm(db, formId);
    if (!found)
      return { ok: false as const, reason: "unavailable" as const, errors: [] };
    const { form, completed } = found;
    const { orgId } = form;
    const gate = await passwordGate(db, form, password, sessionId);
    if (gate.status !== "open")
      return {
        ok: false as const,
        reason:
          gate.status === "locked"
            ? ("locked" as const)
            : ("throttled" as const),
        errors: [],
      };
    const { submissions, responses } = schema;

    const existing = firstRow(
      await db
        .select()
        .from(submissions)
        .where(eq(submissions.sessionId, sessionId))
        .limit(1),
    );
    if (existing && existing.formId !== formId)
      return { ok: false as const, reason: "invalid" as const, errors: [] };
    if (existing?.isCompleted)
      return {
        ok: true as const,
        submissionId: existing.id,
        isCompleted: true,
      };

    if (isClosedNow(form, completed))
      return { ok: false as const, reason: "closed" as const, errors: [] };
    if (!isCompleted && form.settings.partialSubmissions !== true)
      return { ok: false as const, reason: "invalid" as const, errors: [] };

    const checked = validateSubmission(form.publishedBlocks, answers);
    if (isCompleted && checked.errors.length > 0)
      return {
        ok: false as const,
        reason: "invalid" as const,
        errors: checked.errors,
      };
    const kept = checked.answers;
    const ipHash = ipHashFor(formId);
    const dedupeKey = isCompleted
      ? dedupeKeyFor(form, respondentId, ipHash, kept)
      : null;

    if (isCompleted) {
      const unverified = await checkEmailVerification(db, {
        form,
        sessionId,
        answers: kept,
        code: verificationCode,
        ipHash,
      });
      if (unverified) return unverified;
    }

    const questionRows = await loadQuestions(db, orgId, formId);
    const live = new Set(
      questionRows.filter((q) => !q.isDeleted).map((q) => q.id),
    );

    let saved: { id: string; completedNow: boolean };
    try {
      saved = await db.transaction(async (tx) => {
        const id = existing?.id ?? crypto.randomUUID();
        const inserted = existing
          ? []
          : await tx
              .insert(submissions)
              .values({
                id,
                orgId,
                formId,
                sessionId,
                respondentId,
                isCompleted,
                submittedAt: nowIso(),
                dedupeKey,
              })
              .onConflictDoNothing({ target: submissions.sessionId })
              .returning({ id: submissions.id });
        if (!existing && inserted.length === 0) {
          const winner = firstRow(
            await tx
              .select({ id: submissions.id })
              .from(submissions)
              .where(eq(submissions.sessionId, sessionId))
              .limit(1),
          );
          return { id: winner?.id ?? id, completedNow: false };
        }
        if (existing)
          await tx
            .update(submissions)
            .set({ isCompleted, submittedAt: nowIso(), dedupeKey })
            .where(and(orgScope(submissions, orgId), eq(submissions.id, id)));
        await tx
          .delete(responses)
          .where(
            and(orgScope(responses, orgId), eq(responses.submissionId, id)),
          );
        const rows = Object.entries(kept).flatMap(([groupId, value]) =>
          live.has(groupId) && value != null
            ? [
                {
                  id: crypto.randomUUID(),
                  orgId,
                  submissionId: id,
                  questionId: questionRowId(formId, groupId),
                  answer: value,
                },
              ]
            : [],
        );
        if (rows.length) await tx.insert(responses).values(rows);
        return { id, completedNow: isCompleted };
      });
    } catch (error) {
      if (isDuplicateViolation(error))
        return { ok: false as const, reason: "duplicate" as const, errors: [] };
      throw error;
    }
    const submissionId = saved.id;
    if (saved.completedNow)
      await sendSubmissionEmails({
        db,
        form,
        submissionId,
        respondentId,
        ipHash,
        answers: kept,
      });
    return { ok: true as const, submissionId, isCompleted };
  },
});
