import { defineAction } from "@agent-native/core/action";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  questionRowSchema,
  submissionCountsSchema,
  submissionFilterSchema,
  submissionRowSchema,
} from "../shared/form-contract.js";
import { formsAccess, formsErrors, orgScope, requireForm } from "./_access.js";
import {
  filterCondition,
  loadAnswers,
  loadQuestions,
  submissionCounts,
  toSubmissionRow,
} from "./_form-store.js";

export default defineAction({
  description:
    "List a form's submissions, newest first, with one question column per question ever published (deleted questions included) and counts per filter.",
  schema: z.object({
    formId: z.string().describe("Form id"),
    filter: submissionFilterSchema
      .default("all")
      .describe('"all", "completed" or "partial"; defaults to "all"'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .default(100)
      .describe("Page size, 1 to 500; defaults to 100"),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe("Rows to skip; defaults to 0"),
  }),
  outputSchema: z.object({
    submissions: z.array(submissionRowSchema),
    questions: z.array(questionRowSchema),
    counts: submissionCountsSchema,
    hasMore: z.boolean(),
  }),
  errors: formsErrors,
  http: { method: "GET" },
  run: async ({ formId, filter, limit, offset }) => {
    const access = formsAccess();
    await requireForm(access, formId);
    const db = getDb();
    const { submissions } = schema;
    const rows = await db
      .select()
      .from(submissions)
      .where(
        and(
          orgScope(submissions, access.orgId),
          eq(submissions.formId, formId),
          isNull(submissions.deletedAt),
          filterCondition(filter),
        ),
      )
      .orderBy(desc(submissions.submittedAt), desc(submissions.id))
      .limit(limit + 1)
      .offset(offset);
    const page = rows.slice(0, limit);
    const answers = await loadAnswers(
      db,
      access.orgId,
      page.map((row) => row.id),
    );
    return {
      submissions: page.map((row) => toSubmissionRow(row, answers.get(row.id))),
      questions: await loadQuestions(db, access.orgId, formId),
      counts: await submissionCounts(db, access.orgId, formId),
      hasMore: rows.length > limit,
    };
  },
});
