import { defineAction } from "@agent-native/core/action";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  formsAccess,
  formsErrors,
  nowIso,
  orgScope,
  requireForm,
} from "./_access.js";

export default defineAction({
  description:
    "Move submissions of a form to the Trash; restore-submission brings one back.",
  schema: z.object({
    formId: z.string().describe("Form id"),
    ids: z
      .array(z.string())
      .min(1)
      .max(200)
      .describe("Submission ids, up to 200"),
  }),
  outputSchema: z.object({ deleted: z.number() }),
  errors: formsErrors,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async ({ formId, ids }) => {
    const access = formsAccess();
    await requireForm(access, formId);
    const { submissions } = schema;
    const rows = await getDb()
      .update(submissions)
      .set({ deletedAt: nowIso() })
      .where(
        and(
          orgScope(submissions, access.orgId),
          eq(submissions.formId, formId),
          inArray(submissions.id, ids),
          isNull(submissions.deletedAt),
        ),
      )
      .returning({ id: submissions.id });
    return { deleted: rows.length };
  },
});
