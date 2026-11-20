import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { publicFormSchema } from "../shared/form-contract.js";
import { formsErrors } from "./_access.js";
import { publicFormResult } from "./_collection.js";
import { findPublicForm } from "./_form-store.js";

export default defineAction({
  description:
    "Open a password-protected form for a respondent: returns the form when the password is right and the locked state when it is not; no sign-in needed. A POST so the password stays out of URLs.",
  schema: z.object({
    formId: z.string().min(1).max(64).describe("Form id from the public link"),
    password: z.string().max(200).describe("The password the respondent typed"),
    sessionId: z
      .string()
      .max(128)
      .optional()
      .describe("Respondent session; part of the guess-limit key"),
  }),
  outputSchema: publicFormSchema,
  errors: formsErrors,
  requiresAuth: false,
  readOnly: true,
  run: async ({ formId, password, sessionId }) => {
    const found = await findPublicForm(getDb(), formId);
    if (!found) return { state: "unavailable" as const };
    return publicFormResult(getDb(), found, password, sessionId);
  },
});
