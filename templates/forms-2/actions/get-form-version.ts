import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { formSettingsSchema } from "../shared/form-contract.js";
import { blockListSchema } from "../shared/form-model/index.js";
import {
  failNotFound,
  firstRow,
  formsAccess,
  formsErrors,
  requireForm,
} from "./_access.js";

export default defineAction({
  description:
    "Read the blocks and settings saved in one version of a form (ids from list-form-versions).",
  schema: z.object({
    formId: z.string().describe("Form id"),
    versionId: z.string().describe("Version id"),
  }),
  outputSchema: z.object({
    blocks: blockListSchema,
    settings: formSettingsSchema,
  }),
  errors: formsErrors,
  http: { method: "GET" },
  run: async ({ formId, versionId }) => {
    await requireForm(formsAccess(), formId);
    const { formVersions } = schema;
    const row = firstRow(
      await getDb()
        .select()
        .from(formVersions)
        .where(
          and(eq(formVersions.id, versionId), eq(formVersions.formId, formId)),
        )
        .limit(1),
    );
    if (!row) return failNotFound("Version not found.");
    return { blocks: row.blocks, settings: row.settings };
  },
});
