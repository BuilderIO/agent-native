import { defineAction } from "@agent-native/core/action";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  questionRowSchema,
  submissionRowSchema,
} from "../shared/form-contract.js";
import {
  failNotFound,
  firstRow,
  formsAccess,
  formsErrors,
  orgScope,
  requireForm,
} from "./_access.js";
import { loadAnswers, loadQuestions, toSubmissionRow } from "./_form-store.js";

export default defineAction({
  description:
    "Read one submission with its answers and the form's question columns.",
  schema: z.object({ id: z.string().describe("Submission id") }),
  outputSchema: z.object({
    submission: submissionRowSchema,
    questions: z.array(questionRowSchema),
    formName: z.string(),
  }),
  errors: formsErrors,
  http: { method: "GET" },
  run: async ({ id }) => {
    const access = formsAccess();
    const db = getDb();
    const { submissions } = schema;
    const row = firstRow(
      await db
        .select()
        .from(submissions)
        .where(
          and(
            eq(submissions.id, id),
            orgScope(submissions, access.orgId),
            isNull(submissions.deletedAt),
          ),
        )
        .limit(1),
    );
    if (!row) return failNotFound("Submission not found.");
    const { form } = await requireForm(access, row.formId);
    const answers = await loadAnswers(db, access.orgId, [id]);
    return {
      submission: toSubmissionRow(row, answers.get(id)),
      questions: await loadQuestions(db, access.orgId, form.id),
      formName: form.name,
    };
  },
});
