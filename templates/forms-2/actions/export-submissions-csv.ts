import { defineAction } from "@agent-native/core/action";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { submissionFilterSchema } from "../shared/form-contract.js";
import { answerColumns, columnCellText } from "../shared/form-model/index.js";
import { formsAccess, formsErrors, orgScope, requireForm } from "./_access.js";
import { filterCondition, loadAnswers, loadQuestions } from "./_form-store.js";

const MAX_ROWS = 5000;

function cell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export default defineAction({
  description:
    "Export a form's submissions as CSV text (up to 5000 rows, newest first): a Submitted at column then one column per question.",
  schema: z.object({
    formId: z.string().describe("Form id"),
    filter: submissionFilterSchema
      .default("all")
      .describe('"all", "completed" or "partial"; defaults to "all"'),
  }),
  outputSchema: z.object({ filename: z.string(), csv: z.string() }),
  errors: formsErrors,
  http: { method: "GET" },
  run: async ({ formId, filter }) => {
    const access = formsAccess();
    const { form } = await requireForm(access, formId);
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
      .limit(MAX_ROWS);
    const questions = await loadQuestions(db, access.orgId, formId);
    const answers = await loadAnswers(
      db,
      access.orgId,
      rows.map((row) => row.id),
    );
    const columns = answerColumns(questions);
    const lines = [
      ["Submitted at", ...columns.map((column) => column.header)]
        .map(cell)
        .join(","),
      ...rows.map((row) =>
        [
          row.submittedAt,
          ...columns.map((column) =>
            columnCellText(column, answers.get(row.id)?.[column.question.id]),
          ),
        ]
          .map(cell)
          .join(","),
      ),
    ];
    const slug =
      form.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "form";
    return {
      filename: `${slug}-submissions.csv`,
      csv: `${lines.join("\r\n")}\r\n`,
    };
  },
});
