import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type { FormSettings } from "../../shared/form-contract.js";
import type {
  Block,
  ChoiceAnswer,
  FileAnswer,
  MatrixAnswer,
  QuestionOption,
} from "../../shared/form-model/index.js";

export type StoredAnswer =
  | string
  | number
  | ChoiceAnswer
  | MatrixAnswer
  | FileAnswer;

/** Timestamps are ISO-8601 UTC strings, so they sort and compare as text. */
export const workspaces = pgTable(
  "forms_workspaces",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id"),
    createdBy: text("created_by").notNull(),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("forms_workspaces_scope").on(t.orgId, t.createdBy, t.position)],
);

export const forms = pgTable(
  "forms_forms",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id"),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    folderId: text("folder_id"),
    name: text("name").notNull().default(""),
    nameIsCustom: boolean("name_is_custom").notNull().default(false),
    status: text("status").notNull().default("blank"),
    publishedBlocks: jsonb("published_blocks")
      .$type<Block[]>()
      .notNull()
      .default([]),
    draftBlocks: jsonb("draft_blocks").$type<Block[] | null>(),
    settings: jsonb("settings").$type<FormSettings>().notNull().default({}),
    isClosed: boolean("is_closed").notNull().default(false),
    position: integer("position").notNull().default(0),
    publishedAt: text("published_at"),
    /** Last time blocks were saved, published or discarded. */
    revisionUpdatedAt: text("revision_updated_at").notNull(),
    /** Client clock of the newest accepted draft save; older saves are dropped. */
    draftClientAt: bigint("draft_client_at", { mode: "number" }),
    /** scrypt hash of the respondent password; never read into an action result. */
    passwordHash: text("password_hash"),
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("forms_forms_workspace").on(t.workspaceId, t.position),
    index("forms_forms_status").on(t.status, t.updatedAt),
    index("forms_forms_org").on(t.orgId),
  ],
);

export const questions = pgTable(
  "forms_questions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id"),
    formId: text("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    blockGroupId: text("block_group_id").notNull(),
    type: text("type").notNull(),
    title: text("title").notNull().default(""),
    /** Option labels as of the last publish, so deleted questions still read. */
    options: jsonb("options").$type<QuestionOption[]>().notNull().default([]),
    /** Matrix rows as of the last publish; `options` holds its columns. */
    matrixRows: jsonb("matrix_rows")
      .$type<QuestionOption[]>()
      .notNull()
      .default([]),
    isDeleted: boolean("is_deleted").notNull().default(false),
    position: integer("position").notNull().default(0),
  },
  (t) => [uniqueIndex("forms_questions_group").on(t.formId, t.blockGroupId)],
);

export const submissions = pgTable(
  "forms_submissions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id"),
    formId: text("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    respondentId: text("respondent_id").notNull(),
    isCompleted: boolean("is_completed").notNull().default(false),
    submittedAt: text("submitted_at").notNull(),
    /** Set only on completed rows of forms that prevent duplicates. */
    dedupeKey: text("dedupe_key"),
    deletedAt: text("deleted_at"),
  },
  (t) => [
    uniqueIndex("forms_submissions_session").on(t.sessionId),
    uniqueIndex("forms_submissions_dedupe")
      .on(t.formId, t.dedupeKey)
      .where(
        sql`${t.isCompleted} and ${t.dedupeKey} is not null and ${t.deletedAt} is null`,
      ),
    index("forms_submissions_form").on(t.formId, t.submittedAt),
  ],
);

export const responses = pgTable(
  "forms_responses",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id"),
    submissionId: text("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    answer: jsonb("answer").$type<StoredAnswer>().notNull(),
  },
  (t) => [
    uniqueIndex("forms_responses_answer").on(t.submissionId, t.questionId),
    index("forms_responses_question").on(t.questionId),
  ],
);

export const formEvents = pgTable(
  "forms_events",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id"),
    formId: text("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    type: text("type").notNull(),
    /** Page number or question id for page and question events. */
    data: jsonb("data").$type<Record<string, unknown> | null>(),
    at: text("at").notNull(),
  },
  (t) => [
    index("forms_events_form").on(t.formId, t.at),
    index("forms_events_session").on(t.sessionId),
  ],
);

export const folders = pgTable(
  "forms_folders",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id"),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("forms_folders_workspace").on(t.workspaceId, t.position)],
);

export const formVersions = pgTable(
  "forms_form_versions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id"),
    formId: text("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    /** "publish" snapshots are never merged into; "autosave" ones are. */
    kind: text("kind").notNull(),
    blocks: jsonb("blocks").$type<Block[]>().notNull(),
    settings: jsonb("settings").$type<FormSettings>().notNull().default({}),
    author: text("author").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("forms_form_versions_form").on(t.formId, t.createdAt)],
);

export const domains = pgTable(
  "forms_domains",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id"),
    createdBy: text("created_by").notNull(),
    /** Lower-case hostname; unique across orgs because one host serves one org. */
    host: text("host").notNull(),
    verificationToken: text("verification_token").notNull(),
    /** "pending" until a TXT lookup returns the token, then "verified". */
    status: text("status").notNull().default("pending"),
    lastCheckedAt: text("last_checked_at"),
    verifiedAt: text("verified_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("forms_domains_host").on(t.host),
    index("forms_domains_org").on(t.orgId),
  ],
);

export const domainForms = pgTable(
  "forms_domain_forms",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id"),
    domainId: text("domain_id")
      .notNull()
      .references(() => domains.id, { onDelete: "cascade" }),
    formId: text("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("forms_domain_forms_slug").on(t.domainId, t.slug),
    uniqueIndex("forms_domain_forms_form").on(t.domainId, t.formId),
  ],
);

/** One row per accepted respondent upload; the rate limits and the per-submission cap count these. */
export const uploadLog = pgTable(
  "forms_upload_log",
  {
    id: text("id").primaryKey(),
    formId: text("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    ipHash: text("ip_hash"),
    at: text("at").notNull(),
  },
  (t) => [
    index("forms_upload_log_form").on(t.formId, t.at),
    index("forms_upload_log_session").on(t.sessionId, t.at),
    index("forms_upload_log_ip").on(t.formId, t.ipHash, t.at),
  ],
);

/** One row per respondent notification mailed; the per-address and per-form caps count these. */
export const respondentMailLog = pgTable(
  "forms_respondent_mail_log",
  {
    id: text("id").primaryKey(),
    formId: text("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    ipHash: text("ip_hash"),
    at: text("at").notNull(),
  },
  (t) => [
    index("forms_respondent_mail_log_form").on(t.formId, t.at),
    index("forms_respondent_mail_log_ip").on(t.formId, t.ipHash, t.at),
  ],
);

/** One row per (session, email question): the pending or accepted verification code. */
export const emailVerifications = pgTable(
  "forms_email_verifications",
  {
    id: text("id").primaryKey(),
    formId: text("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    questionId: text("question_id").notNull(),
    email: text("email").notNull(),
    /** HMAC of the code; the code itself is only ever in the mail. */
    codeHash: text("code_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
    sendCount: integer("send_count").notNull().default(1),
    ipHash: text("ip_hash"),
    verifiedAt: text("verified_at"),
    lastSentAt: text("last_sent_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("forms_email_verifications_slot").on(
      t.formId,
      t.sessionId,
      t.questionId,
    ),
    index("forms_email_verifications_ip").on(t.formId, t.ipHash, t.createdAt),
  ],
);

/** Failed password guesses per window; `key` is form + client, or the form alone. */
export const passwordAttempts = pgTable("forms_password_attempts", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  windowStart: text("window_start").notNull(),
});
