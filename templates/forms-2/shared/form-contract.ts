import { z } from "zod";

import {
  answersSchema,
  answerValueSchema,
  blockListSchema,
  ANSWER_TYPES,
  VALIDATION_CODES,
} from "./form-model/index.js";
import { customCssSchema, formThemeSchema } from "./theme/form-theme.js";

export const FORM_STATUSES = [
  "blank",
  "draft",
  "published",
  "deleted",
] as const;
export const formStatusSchema = z.enum(FORM_STATUSES);
export type FormStatus = z.infer<typeof formStatusSchema>;

export const DEFAULT_WORKSPACE_NAME = "My workspace";

/** Where the public form lives; `/f/:formId` is fixed by the scope decision. */
export const publicFormPath = (formId: string) => `/f/${formId}`;

export const RETENTION_UNITS = [
  "minute",
  "hour",
  "day",
  "week",
  "month",
  "year",
] as const;
export type RetentionUnit = (typeof RETENTION_UNITS)[number];

export const MAX_NOTIFY_RECIPIENTS = 5;

export const formSettingsSchema = z.looseObject({
  closedMessage: z.string().max(2000).optional(),
  submissionsLimit: z.number().int().min(1).nullable().optional(),
  /** ISO timestamp after which the form stops accepting responses. */
  closeAt: z.string().max(40).nullable().optional(),
  redirectOnCompletion: z
    .object({ enabled: z.boolean(), url: z.string().max(2000) })
    .optional(),
  progressBar: z.boolean().optional(),
  autoJump: z.boolean().optional(),
  language: z.string().max(20).optional(),
  /** Defaults on: answers survive a reload until the form is submitted. */
  saveAnswersForLater: z.boolean().optional(),
  partialSubmissions: z.boolean().optional(),
  preventDuplicates: z.boolean().optional(),
  /** "respondent", "ip" or "field:<questionId>"; respondent when unset. */
  uniqueSubmissionKey: z.string().max(100).optional(),
  /** The gate is on when true; the password itself lives only as a hash. */
  passwordProtected: z.boolean().optional(),
  dataRetention: z
    .object({
      enabled: z.boolean(),
      value: z.number().int().min(1).max(100_000),
      unit: z.enum(RETENTION_UNITS),
    })
    .optional(),
  /** Mail to the owner and chosen addresses on each completed submission. */
  selfEmail: z
    .object({
      enabled: z.boolean(),
      to: z.array(z.email().max(254)).max(MAX_NOTIFY_RECIPIENTS),
    })
    .optional(),
  /** Confirmation to the address answered in one email question; subject and message may hold mention tokens. */
  respondentEmail: z
    .object({
      enabled: z.boolean(),
      toQuestionId: z.string().max(100),
      subject: z.string().max(200),
      message: z.string().max(5000),
    })
    .optional(),
  /** The respondent's final button. Empty keeps the built-in copy. */
  submitLabel: z.string().max(60).optional(),
  theme: formThemeSchema.optional(),
  /** Applied on respondent surfaces only; sanitized on write with `sanitizeCss`. */
  customCss: customCssSchema.optional(),
});
export type FormSettings = z.infer<typeof formSettingsSchema>;

export const folderSchema = z.object({
  id: z.string(),
  name: z.string(),
  position: z.number(),
  formCount: z.number(),
});
export type Folder = z.infer<typeof folderSchema>;

export const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  position: z.number(),
  formCount: z.number(),
  folders: z.array(folderSchema),
});

export const formSummarySchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  /** The folder holding the form, or null at the top level of the workspace. */
  folderId: z.string().nullable(),
  name: z.string(),
  status: formStatusSchema,
  isClosed: z.boolean(),
  /** True when a published form has edits that are not live yet. */
  hasDraftBlocks: z.boolean(),
  /** Completed, not deleted, submissions. */
  submissionCount: z.number(),
  position: z.number(),
  updatedAt: z.string(),
});
export type FormSummary = z.infer<typeof formSummarySchema>;

export const workspaceWithFormsSchema = workspaceSchema.extend({
  forms: z.array(formSummarySchema),
});

export const formDetailSchema = formSummarySchema.extend({
  workspaceName: z.string(),
  nameIsCustom: z.boolean(),
  publishedBlocks: blockListSchema,
  draftBlocks: blockListSchema.nullable(),
  settings: formSettingsSchema,
  publishedAt: z.string().nullable(),
  /** Changes whenever blocks are saved, published or discarded. */
  revisionUpdatedAt: z.string(),
  acceptingResponses: z.boolean(),
});
export type FormDetail = z.infer<typeof formDetailSchema>;

const questionOptionSchema = z.object({
  id: z.string(),
  text: z.string(),
  isOther: z.boolean(),
});

export const questionRowSchema = z.object({
  /** The block group uuid; the key of `answers` in every submission payload. */
  id: z.string(),
  type: z.enum(ANSWER_TYPES),
  title: z.string(),
  position: z.number(),
  isDeleted: z.boolean(),
  options: z.array(questionOptionSchema),
  /** Matrix rows; empty for every other question type. */
  rows: z.array(questionOptionSchema),
});
export type QuestionRow = z.infer<typeof questionRowSchema>;

export const submissionFilterSchema = z.enum(["all", "completed", "partial"]);

export const submissionRowSchema = z.object({
  id: z.string(),
  formId: z.string(),
  isCompleted: z.boolean(),
  submittedAt: z.string(),
  answers: answersSchema,
});
export type SubmissionRow = z.infer<typeof submissionRowSchema>;

export const submissionCountsSchema = z.object({
  all: z.number(),
  completed: z.number(),
  partial: z.number(),
});

export const trashItemKinds = [
  "form",
  "submission",
  "workspace",
  "folder",
] as const;
export const trashItemSchema = z.object({
  kind: z.enum(trashItemKinds),
  id: z.string(),
  name: z.string(),
  /** Form name for a submission, workspace name for a form. */
  parentName: z.string().nullable(),
  deletedAt: z.string(),
});

/** What `get-public-form` tells a visitor; unavailable never says why. */
export const publicFormSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("open"),
    form: z.object({
      id: z.string(),
      name: z.string(),
      blocks: blockListSchema,
      settings: formSettingsSchema,
    }),
  }),
  z.object({ state: z.literal("closed"), message: z.string().nullable() }),
  /** Password gate: no blocks, only what styles the gate. */
  z.object({
    state: z.literal("locked"),
    /** Set when too many wrong passwords were tried; the gate shows a cool-down. */
    retryAfterSeconds: z.number().optional(),
    name: z.string(),
    settings: formSettingsSchema,
  }),
  z.object({ state: z.literal("unavailable") }),
]);
export type PublicFormResult = z.infer<typeof publicFormSchema>;

export const submitResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    submissionId: z.string(),
    isCompleted: z.boolean(),
  }),
  z.object({
    ok: z.literal(false),
    reason: z.enum([
      "closed",
      "unavailable",
      "invalid",
      "locked",
      "duplicate",
      "throttled",
      "verify",
      "wrong_code",
      "code_expired",
      "code_limit",
      // The deployment cannot send mail at all, so no code was issued. Distinct from
      // "verify" (one was sent) because the respondent must not wait for an email.
      "verify_unavailable",
    ]),
    /** The address a verification code was sent to; set with the four verify reasons. */
    verifyEmail: z.string().optional(),
    errors: z.array(
      z.object({
        questionId: z.string(),
        code: z.enum(VALIDATION_CODES),
        min: z.union([z.number(), z.string()]).optional(),
        max: z.union([z.number(), z.string()]).optional(),
      }),
    ),
  }),
]);
export type SubmitResult = z.infer<typeof submitResultSchema>;

export const FORM_EVENT_TYPES = [
  "visit",
  "start",
  "page_view",
  "question_view",
  "question_answer",
  "drop_off",
] as const;

export const INSIGHT_PERIODS = [
  "all",
  "today",
  "yesterday",
  "24h",
  "7d",
  "30d",
  "3m",
  "6m",
  "12m",
] as const;

export const questionSummarySchema = z.object({
  question: questionRowSchema,
  answerCount: z.number(),
  /** Choice questions: one entry per option plus a count for "other". */
  choices: z.array(
    z.object({ optionId: z.string(), text: z.string(), count: z.number() }),
  ),
  /** Rating and linear scale: mean, and a count per value. */
  average: z.number().nullable(),
  distribution: z.array(z.object({ value: z.number(), count: z.number() })),
  /** Text-like questions: the newest answers, capped. */
  recent: z.array(
    z.object({
      submissionId: z.string(),
      text: z.string(),
      submittedAt: z.string(),
    }),
  ),
});

export { answerValueSchema };

export const formInsightsSchema = z.object({
  visits: z.number(),
  starts: z.number(),
  submissions: z.number(),
  uniqueRespondents: z.number(),
  /** 0..1; zero when there are no visits. */
  completionRate: z.number(),
  visitDurationMs: z.number().nullable(),
  /** Mean time from a completed submission's first event to its submit. */
  completionDurationMs: z.number().nullable(),
  questions: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      type: z.enum(ANSWER_TYPES),
      isDeleted: z.boolean(),
      answerCount: z.number(),
    }),
  ),
});
export type FormInsights = z.infer<typeof formInsightsSchema>;
