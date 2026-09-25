import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  CLIPS_CALL_EVIDENCE_RECIPE_ID,
  buildClipsCallEvidenceRecipe,
} from "../shared/crm-automation-recipes.js";

export default defineAction({
  description:
    "Return the default-off Clips call-evidence review recipe for one explicitly selected CRM record. The recipe never passes media, transcripts, or an event URL into CRM.",
  schema: z.object({
    recipeId: z
      .literal(CLIPS_CALL_EVIDENCE_RECIPE_ID)
      .default(CLIPS_CALL_EVIDENCE_RECIPE_ID),
    recordId: z.string().trim().min(1).max(128),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ recordId }) => {
    await assertAccess("crm-record", recordId, "viewer");
    const [record] = await getDb()
      .select({ displayName: schema.crmRecords.displayName })
      .from(schema.crmRecords)
      .where(eq(schema.crmRecords.id, recordId))
      .limit(1);
    if (!record) throw new Error("CRM record was not found.");
    return buildClipsCallEvidenceRecipe({
      recordId,
      recordLabel: record.displayName,
    });
  },
});
