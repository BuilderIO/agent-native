import { defineAction } from "@agent-native/core/action";
import { and, eq, gte, lt } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { INSIGHT_PERIODS, questionRowSchema } from "../shared/form-contract.js";
import { formsAccess, formsErrors, orgScope, requireForm } from "./_access.js";
import { loadQuestions, periodRange } from "./_form-store.js";

export default defineAction({
  description:
    "Per-question drop-off for a form, in form order: how many respondent sessions answered the question, and how many of those never submitted after it as their last answer.",
  schema: z.object({
    formId: z.string().describe("Form id"),
    period: z
      .enum(INSIGHT_PERIODS)
      .default("all")
      .describe("Same periods as get-form-insights; defaults to all"),
  }),
  outputSchema: z.object({
    questions: z.array(
      z.object({
        question: questionRowSchema,
        answered: z.number(),
        droppedOff: z.number(),
      }),
    ),
  }),
  errors: formsErrors,
  http: { method: "GET" },
  run: async ({ formId, period }) => {
    const access = formsAccess();
    await requireForm(access, formId);
    const db = getDb();
    const { formEvents, submissions } = schema;
    const { from, to } = periodRange(period);

    const answers = await db
      .select({
        sessionId: formEvents.sessionId,
        data: formEvents.data,
        at: formEvents.at,
      })
      .from(formEvents)
      .where(
        and(
          orgScope(formEvents, access.orgId),
          eq(formEvents.formId, formId),
          eq(formEvents.type, "question_answer"),
          from ? gte(formEvents.at, from) : undefined,
          to ? lt(formEvents.at, to) : undefined,
        ),
      )
      .orderBy(formEvents.at)
      .limit(20000);
    const finished = new Set(
      (
        await db
          .select({ sessionId: submissions.sessionId })
          .from(submissions)
          .where(
            and(
              orgScope(submissions, access.orgId),
              eq(submissions.formId, formId),
              eq(submissions.isCompleted, true),
            ),
          )
          .limit(20000)
      ).map((row) => row.sessionId),
    );

    const answeredBy = new Map<string, Set<string>>();
    const lastAnswer = new Map<string, string>();
    for (const row of answers) {
      const questionId = row.data?.questionId;
      if (typeof questionId !== "string") continue;
      const sessions = answeredBy.get(questionId) ?? new Set<string>();
      sessions.add(row.sessionId);
      answeredBy.set(questionId, sessions);
      lastAnswer.set(row.sessionId, questionId);
    }
    const droppedAt = new Map<string, number>();
    for (const [sessionId, questionId] of lastAnswer)
      if (!finished.has(sessionId))
        droppedAt.set(questionId, (droppedAt.get(questionId) ?? 0) + 1);

    const rows = await loadQuestions(db, access.orgId, formId);
    return {
      questions: rows.map((question) => ({
        question,
        answered: answeredBy.get(question.id)?.size ?? 0,
        droppedOff: droppedAt.get(question.id) ?? 0,
      })),
    };
  },
});
