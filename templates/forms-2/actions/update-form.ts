import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { formsAccess, formsErrors, nowIso, requireForm } from "./_access.js";

export default defineAction({
  description:
    "Rename a form (the name then stops following the title block) or change its position in its workspace.",
  schema: z.object({
    id: z.string().describe("Form id"),
    name: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe("New form name"),
    position: z.number().int().min(0).optional().describe("New list position"),
  }),
  outputSchema: z.object({ id: z.string(), name: z.string() }),
  errors: formsErrors,
  run: async ({ id, name, position }) => {
    const access = formsAccess();
    const { form } = await requireForm(access, id);
    await getDb()
      .update(schema.forms)
      .set({
        ...(name === undefined ? {} : { name, nameIsCustom: true }),
        ...(position === undefined ? {} : { position }),
        updatedAt: nowIso(),
      })
      .where(eq(schema.forms.id, id));
    return { id, name: name ?? form.name };
  },
});
