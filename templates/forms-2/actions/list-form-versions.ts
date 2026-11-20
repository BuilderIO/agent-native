import { defineAction } from "@agent-native/core/action";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { formsAccess, formsErrors, requireForm } from "./_access.js";
import { MAX_VERSIONS } from "./_versions.js";

export default defineAction({
  description: `List a form's saved versions, newest first (at most ${MAX_VERSIONS}). The first is the current one. Publishing saves a version; editing saves one at most every 5 minutes. Read one with get-form-version.`,
  schema: z.object({ formId: z.string().describe("Form id") }),
  outputSchema: z.object({
    versions: z.array(
      z.object({
        id: z.string(),
        kind: z.string().describe('"publish" or "autosave"'),
        author: z.string(),
        createdAt: z.string(),
        updatedAt: z.string(),
      }),
    ),
  }),
  errors: formsErrors,
  http: { method: "GET" },
  run: async ({ formId }) => {
    await requireForm(formsAccess(), formId);
    const { formVersions } = schema;
    const rows = await getDb()
      .select({
        id: formVersions.id,
        kind: formVersions.kind,
        author: formVersions.author,
        createdAt: formVersions.createdAt,
        updatedAt: formVersions.updatedAt,
      })
      .from(formVersions)
      .where(eq(formVersions.formId, formId))
      .orderBy(desc(formVersions.createdAt), desc(formVersions.id))
      .limit(MAX_VERSIONS);
    return { versions: rows };
  },
});
