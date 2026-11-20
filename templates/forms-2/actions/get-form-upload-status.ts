import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { formsErrors } from "./_access.js";
import { findPublicForm, isClosedNow } from "./_form-store.js";
import {
  formOwner,
  ownerStorageConfigured,
  uploadQuestions,
} from "./_upload-storage.js";

export default defineAction({
  description:
    "Whether a published form's respondents can upload files: none when the form has no file or signature question, unavailable when its owner has no file storage connected; no sign-in needed.",
  schema: z.object({
    formId: z.string().min(1).max(64).describe("Form id from the public link"),
  }),
  outputSchema: z.object({
    state: z.enum(["none", "available", "unavailable"]),
  }),
  errors: formsErrors,
  requiresAuth: false,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ formId }) => {
    const db = getDb();
    const found = await findPublicForm(db, formId);
    if (
      !found ||
      isClosedNow(found.form, found.completed) ||
      uploadQuestions(found.form).length === 0
    )
      return { state: "none" as const };
    const owner = await formOwner(db, found.form);
    return {
      state:
        owner && (await ownerStorageConfigured(owner))
          ? ("available" as const)
          : ("unavailable" as const),
    };
  },
});
