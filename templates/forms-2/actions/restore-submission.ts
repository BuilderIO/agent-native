import { defineAction } from "@agent-native/core/action";
import { and, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  failNotFound,
  firstRow,
  formsAccess,
  formsErrors,
  orgScope,
  requireForm,
} from "./_access.js";
import {
  RESTORE_DUPLICATE_MESSAGE,
  restoreSubmissionRow,
} from "./_collection.js";

export default defineAction({
  description: "Restore a submission from the Trash.",
  schema: z.object({ id: z.string().describe("Submission id") }),
  outputSchema: z.object({ id: z.string() }),
  errors: formsErrors,
  run: async ({ id }) => {
    const access = formsAccess();
    const { submissions } = schema;
    const db = getDb();
    const row = firstRow(
      await db
        .select()
        .from(submissions)
        .where(
          and(
            eq(submissions.id, id),
            orgScope(submissions, access.orgId),
            isNotNull(submissions.deletedAt),
          ),
        )
        .limit(1),
    );
    if (!row) return failNotFound("Submission not found.");
    await requireForm(access, row.formId);
    if (!(await restoreSubmissionRow(db, id, access.orgId)))
      return formsErrors.noWrite(RESTORE_DUPLICATE_MESSAGE, "conflict");
    return { id };
  },
});
