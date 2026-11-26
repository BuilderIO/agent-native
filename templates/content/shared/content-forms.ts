import { z } from "zod";

export const CONTENT_FORM_AUDIENCES = [
  "anonymous",
  "signed_in",
  "organization",
] as const;
export type ContentFormAudience = (typeof CONTENT_FORM_AUDIENCES)[number];

export const CONTENT_FORM_SENDER_KINDS = ["anonymous", "signed_in"] as const;
export type ContentFormSenderKind = (typeof CONTENT_FORM_SENDER_KINDS)[number];

export const CONTENT_FORM_CHANNELS = ["collection", "link"] as const;
export type ContentFormChannel = (typeof CONTENT_FORM_CHANNELS)[number];

export const CONTENT_FORM_ANSWER_TYPES = [
  "text",
  "long_text",
  "number",
  "one_choice",
  "several_choices",
  "date",
  "checkbox",
  "email",
  "url",
  "phone",
  "people",
  "place",
] as const;
export type ContentFormAnswerType = (typeof CONTENT_FORM_ANSWER_TYPES)[number];

export const CONTENT_FORM_REFUSAL_CODES = [
  "form_not_found",
  "form_unavailable",
  "form_closed",
  "sign_in_required",
  "organization_only",
  "already_answered",
  "too_many_submissions",
  "idempotency_conflict",
  "form_changed",
  "drafts_unavailable",
] as const;
export type ContentFormRefusalCode =
  (typeof CONTENT_FORM_REFUSAL_CODES)[number];

export const CONTENT_FORM_THANK_YOU_MAX_LENGTH = 2_000;
export const CONTENT_FORM_IDEMPOTENCY_KEY_MIN_LENGTH = 16;
export const CONTENT_FORM_IDEMPOTENCY_KEY_MAX_LENGTH = 200;
export const CONTENT_FORM_MAX_ANSWERS = 200;
export const CONTENT_FORM_DRAFT_TTL_DAYS = 30;
export const CONTENT_FORM_LINK_PREFIX = "/form/";

const LINK_TOKEN = /^[A-Za-z0-9_-]{24,128}$/;

export function contentFormLinkPath(token: string): string {
  return `${CONTENT_FORM_LINK_PREFIX}${token}`;
}

export function parseContentFormLink(link: string): string | null {
  const text = link.trim();
  if (LINK_TOKEN.test(text)) return text;
  const pathname = URL.canParse(text)
    ? new URL(text).pathname
    : URL.canParse(text, "https://form.invalid")
      ? new URL(text, "https://form.invalid").pathname
      : "";
  const token = /\/form\/([^/?#]+)\/?$/.exec(pathname)?.[1];
  return token && LINK_TOKEN.test(token) ? token : null;
}

export const contentFormLinkSchema = z
  .string()
  .min(1)
  .max(2_048)
  .describe(
    "The form's link, such as https://<content app>/form/<token>, or the token itself",
  );

export const contentFormAnswerEntrySchema = z.object({
  question: z
    .string()
    .min(1)
    .max(200)
    .describe("The question's key from get-content-form"),
  value: z
    .unknown()
    .describe(
      "The answer: text, a number, true or false, a date as YYYY-MM-DD, one choice's label, or a list of labels for several choices",
    ),
});
export type ContentFormAnswerEntry = z.infer<
  typeof contentFormAnswerEntrySchema
>;

export const contentFormAnswersSchema = z
  .array(contentFormAnswerEntrySchema)
  .max(CONTENT_FORM_MAX_ANSWERS);

export const contentFormSettingsSchema = z.object({
  databaseId: z.string(),
  viewId: z.string(),
  configured: z.boolean(),
  audience: z.enum(CONTENT_FORM_AUDIENCES),
  oneAnswerPerPerson: z.boolean(),
  acceptingAnswers: z.boolean(),
  thankYouMessage: z.string(),
  canvasDocumentId: z.string().nullable(),
  link: z.object({ token: z.string(), path: z.string() }).nullable(),
});
export type ContentFormSettings = z.infer<typeof contentFormSettingsSchema>;

export const contentFormChoiceSchema = z.object({
  id: z.string(),
  label: z.string(),
});

export const contentFormQuestionSchema = z.object({
  key: z.string(),
  wording: z.string(),
  help: z.string().nullable(),
  placeholder: z.string().nullable(),
  required: z.boolean(),
  answerType: z.enum(CONTENT_FORM_ANSWER_TYPES),
  choices: z.array(contentFormChoiceSchema).optional(),
});
export type ContentFormQuestion = z.infer<typeof contentFormQuestionSchema>;

export const contentFormSenderSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("anonymous") }),
  z.object({ kind: z.literal("signed_in"), email: z.string() }),
]);
export type ContentFormSender = z.infer<typeof contentFormSenderSchema>;

export const contentFormReceiptAnswerSchema = z.object({
  question: z.string(),
  wording: z.string(),
  value: z.unknown(),
});

export const contentFormReceiptSchema = z.object({
  receiptId: z.string(),
  formTitle: z.string(),
  submittedAt: z.string(),
  answers: z.array(contentFormReceiptAnswerSchema),
  record: z.object({
    documentId: z.string(),
    itemId: z.string(),
    urlPath: z.string(),
    deepLink: z.string(),
  }),
  thankYouMessage: z.string(),
  sender: contentFormSenderSchema,
  idempotencyKey: z.string(),
});
export type ContentFormReceipt = z.infer<typeof contentFormReceiptSchema>;

export const contentFormProblemSchema = z.object({
  question: z.string(),
  wording: z.string().nullable(),
  message: z.string(),
});
export type ContentFormProblem = z.infer<typeof contentFormProblemSchema>;

export const contentFormRefusalSchema = z.object({
  code: z.enum(CONTENT_FORM_REFUSAL_CODES),
  message: z.string(),
});
export type ContentFormRefusal = z.infer<typeof contentFormRefusalSchema>;

export const contentFormReadSchema = z.object({
  title: z.string(),
  canvas: z.string().nullable(),
  questions: z.array(contentFormQuestionSchema),
  answerSchema: z.record(z.string(), z.unknown()),
  answering: z.object({
    as: z.enum(CONTENT_FORM_SENDER_KINDS),
    canSubmit: z.boolean(),
    refusal: contentFormRefusalSchema.nullable(),
  }),
  sent: z.array(contentFormReceiptSchema),
});
export type ContentFormRead = z.infer<typeof contentFormReadSchema>;

export const contentFormSubmitResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("submitted"),
    replayed: z.boolean(),
    message: z.string(),
    receipt: contentFormReceiptSchema,
  }),
  z.object({
    outcome: z.literal("needs_changes"),
    message: z.string(),
    problems: z.array(contentFormProblemSchema),
  }),
]);
export type ContentFormSubmitResult = z.infer<
  typeof contentFormSubmitResultSchema
>;

export const contentFormDraftSchema = z.object({
  answers: contentFormAnswersSchema,
  updatedAt: z.string(),
  expiresAt: z.string(),
});
export type ContentFormDraft = z.infer<typeof contentFormDraftSchema>;

export const contentFormDraftOrNoneSchema = contentFormDraftSchema.nullable();
