import { z } from "zod";

import {
  FIELD_ID_PATTERN,
  FIELD_TYPES,
} from "../server/lib/validate-fields.js";

const fieldIdSchema = z.string().regex(FIELD_ID_PATTERN);

export const formFieldSchema = z
  .object({
    id: fieldIdSchema
      .optional()
      .describe(
        "Stable field id (letters, digits, _ and - only). Omit on create-form/update-form to auto-generate one from the label. Required on patch-form-fields upsert to target an existing field, and as the referenced fieldId in another field's `conditional`.",
      ),
    type: z
      .enum(FIELD_TYPES)
      .describe(`Field type. One of: ${FIELD_TYPES.join(", ")}.`),
    label: z.string().describe("Question text shown to respondents."),
    required: z
      .boolean()
      .describe("Whether the respondent must fill this in before submitting."),
    placeholder: z
      .string()
      .optional()
      .describe(
        "Placeholder text. Used by text, email, number, textarea, date fields.",
      ),
    description: z
      .string()
      .optional()
      .describe("Help text rendered under the label."),
    width: z
      .enum(["full", "half"])
      .optional()
      .describe("Layout width on the fill page. Defaults to full."),
    options: z
      .array(z.string())
      .optional()
      .describe(
        "Choice list. Required for select, multiselect, radio, checkbox; unused otherwise.",
      ),
    validation: z
      .object({
        min: z
          .number()
          .optional()
          .describe(
            "Minimum value (number, rating, scale) or minimum text length (text, textarea).",
          ),
        max: z
          .number()
          .optional()
          .describe(
            "Maximum value (number, rating, scale) or maximum text length (text, textarea).",
          ),
        pattern: z
          .string()
          .optional()
          .describe("Regular expression the value must match (text, email)."),
        message: z
          .string()
          .optional()
          .describe("Custom validation error message."),
      })
      .optional()
      .describe(
        "Value constraints: min/max bounds and/or a regex pattern with an optional custom message.",
      ),
    conditional: z
      .object({
        fieldId: fieldIdSchema.describe(
          "Id of an earlier field in the same form this one depends on.",
        ),
        operator: z.enum(["equals", "not_equals", "contains"]),
        value: z.string(),
      })
      .optional()
      .describe(
        "Show this field only when an earlier field's answer matches. fieldId must reference a field positioned before this one in the array.",
      ),
    multiple: z
      .boolean()
      .optional()
      .describe("file fields only: allow more than one uploaded file."),
    accept: z
      .string()
      .optional()
      .describe(
        "file fields only: accepted file types/extensions, e.g. 'image/*,.pdf'.",
      ),
    maxSizeBytes: z
      .number()
      .optional()
      .describe("file fields only: max size per file, in bytes."),
    maxFiles: z
      .number()
      .optional()
      .describe(
        "file fields only: max number of files. Requires multiple: true.",
      ),
  })
  .describe(
    "A complete form field. Which properties apply depends on `type` — see each property's own description.",
  );
