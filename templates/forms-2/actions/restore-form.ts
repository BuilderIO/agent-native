import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { formStatusSchema } from "../shared/form-contract.js";
import { formsAccess, formsErrors, nowIso, requireForm } from "./_access.js";
import { restoredStatus } from "./_form-store.js";

export default defineAction({
  description: "Restore a form from the Trash.",
  schema: z.object({ id: z.string().describe("Form id") }),
  outputSchema: z.object({ id: z.string(), status: formStatusSchema }),
  errors: formsErrors,
  run: async ({ id }) => {
    const access = formsAccess();
    const { form } = await requireForm(access, id, { deleted: "only" });
    const status = restoredStatus(form);
    await getDb()
      .update(schema.forms)
      .set({ status, deletedAt: null, updatedAt: nowIso() })
      .where(eq(schema.forms.id, id));
    return { id, status };
  },
});
