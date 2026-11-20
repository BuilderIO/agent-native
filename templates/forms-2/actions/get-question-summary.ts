import { defineAction } from "@agent-native/core/action";
import { and, desc, eq, gte, isNull, lt } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  INSIGHT_PERIODS,
  questionSummarySchema,
} from "../shared/form-contract.js";
import {
  answerToText,
  isChoiceAnswer,
  isMatrixAnswer,
} from "../shared/form-model/index.js";
import {
  failNotFound,
  formsAccess,
  formsErrors,
  orgScope,
  requireForm,
} from "./_access.js";
import { loadQuestions, periodRange, questionRowId } from "./_form-store.js";

const SCAN_LIMIT = 5000;
const RECENT_LIMIT = 50;

export default defineAction({
  description:
    "Summarize one question's answers from completed submissions: option counts for choices, average and distribution for ratings and scales, newest answers for text.",
  schema: z.object({
    formId: z.string().describe("Form id"),
    questionId: z
      .string()
      .describe("Question id (the block group uuid) from get-form-insights"),
    period: z
      .enum(INSIGHT_PERIODS)
      .default("all")
      .describe("Same periods as get-form-insights; defaults to all"),
  }),
  outputSchema: questionSummarySchema,
  errors: formsErrors,
  http: { method: "GET" },
  run: async ({ formId, questionId, period }) => {
    const access = formsAccess();
    await requireForm(access, formId);
    const db = getDb();
    const question = (await loadQuestions(db, access.orgId, formId)).find(
      (row) => row.id === questionId,
    );
    if (!question) return failNotFound("Question not found.");
    const { responses, submissions } = schema;
    const { from, to } = periodRange(period);
    const rows = await db
      .select({
        submissionId: submissions.id,
        submittedAt: submissions.submittedAt,
        answer: responses.answer,
      })
      .from(responses)
      .innerJoin(submissions, eq(submissions.id, responses.submissionId))
      .where(
        and(
          orgScope(responses, access.orgId),
          orgScope(submissions, access.orgId),
          eq(responses.questionId, questionRowId(formId, questionId)),
          eq(submissions.isCompleted, true),
          isNull(submissions.deletedAt),
          from ? gte(submissions.submittedAt, from) : undefined,
          to ? lt(submissions.submittedAt, to) : undefined,
        ),
      )
      .orderBy(desc(submissions.submittedAt))
      .limit(SCAN_LIMIT);

    const choiceCounts = new Map<string, number>();
    const valueCounts = new Map<number, number>();
    let sum = 0;
    let numeric = 0;
    for (const row of rows) {
      // A ranking lists every option, so only its first place says anything.
      const picked = isChoiceAnswer(row.answer)
        ? question.type === "RANKING"
          ? row.answer.selected.slice(0, 1)
          : row.answer.selected
        : isMatrixAnswer(row.answer)
          ? Object.values(row.answer.matrix).flat()
          : null;
      if (picked)
        for (const id of picked)
          choiceCounts.set(id, (choiceCounts.get(id) ?? 0) + 1);
      else if (typeof row.answer === "number") {
        valueCounts.set(row.answer, (valueCounts.get(row.answer) ?? 0) + 1);
        sum += row.answer;
        numeric += 1;
      }
    }
    const isText = !question.options.length && numeric === 0;
    return {
      question,
      answerCount: rows.length,
      choices: question.options.map((option) => ({
        optionId: option.id,
        text: option.text,
        count: choiceCounts.get(option.id) ?? 0,
      })),
      average: numeric ? sum / numeric : null,
      distribution: [...valueCounts]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => a.value - b.value),
      recent: isText
        ? rows.slice(0, RECENT_LIMIT).map((row) => ({
            submissionId: row.submissionId,
            text: answerToText(question, row.answer),
            submittedAt: row.submittedAt,
          }))
        : [],
    };
  },
});
