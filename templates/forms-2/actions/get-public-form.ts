import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { publicFormSchema } from "../shared/form-contract.js";
import { formsErrors } from "./_access.js";
import { publicFormResult } from "./_collection.js";
import { findPublicForm } from "./_form-store.js";

export default defineAction({
  description:
    "Read a published form for a respondent: its published blocks only. A draft, deleted or missing form is unavailable, a closed form says closed and a password-protected form is locked with no blocks until unlock-form; no sign-in needed.",
  schema: z.object({
    formId: z.string().min(1).max(64).describe("Form id from the public link"),
  }),
  outputSchema: publicFormSchema,
  errors: formsErrors,
  requiresAuth: false,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ formId }) => {
    const found = await findPublicForm(getDb(), formId);
    if (!found) return { state: "unavailable" as const };
    return publicFormResult(getDb(), found);
  },
});
