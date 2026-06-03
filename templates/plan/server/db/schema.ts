import {
  table,
  text,
  integer,
  ownableColumns,
  createSharesTable,
} from "@agent-native/core/db/schema";
import {
  PLAN_AUTHORS,
  PLAN_COMMENT_KINDS,
  PLAN_COMMENT_STATUSES,
  PLAN_SECTION_TYPES,
  PLAN_SOURCES,
  PLAN_STATUSES,
} from "../../shared/types.js";

export const plans = table("plans", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  brief: text("brief").notNull(),
  status: text("status", { enum: PLAN_STATUSES }).notNull().default("draft"),
  source: text("source", { enum: PLAN_SOURCES }).notNull().default("manual"),
  repoPath: text("repo_path"),
  currentFocus: text("current_focus"),
  html: text("html"),
  markdown: text("markdown"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  approvedAt: text("approved_at"),
  ...ownableColumns(),
});

export const planSections = table("plan_sections", {
  id: text("id").primaryKey(),
  planId: text("plan_id")
    .notNull()
    .references(() => plans.id),
  type: text("type", { enum: PLAN_SECTION_TYPES }).notNull().default("custom"),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  html: text("html"),
  order: integer("sort_order").notNull().default(0),
  createdBy: text("created_by", { enum: PLAN_AUTHORS })
    .notNull()
    .default("agent"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const planComments = table("plan_comments", {
  id: text("id").primaryKey(),
  planId: text("plan_id")
    .notNull()
    .references(() => plans.id),
  sectionId: text("section_id").references(() => planSections.id),
  kind: text("kind", { enum: PLAN_COMMENT_KINDS }).notNull().default("comment"),
  status: text("status", { enum: PLAN_COMMENT_STATUSES })
    .notNull()
    .default("open"),
  anchor: text("anchor"),
  message: text("message").notNull(),
  createdBy: text("created_by", { enum: PLAN_AUTHORS })
    .notNull()
    .default("human"),
  consumedAt: text("consumed_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const planEvents = table("plan_events", {
  id: text("id").primaryKey(),
  planId: text("plan_id")
    .notNull()
    .references(() => plans.id),
  type: text("type").notNull(),
  message: text("message").notNull(),
  payload: text("payload"),
  createdBy: text("created_by", { enum: PLAN_AUTHORS })
    .notNull()
    .default("agent"),
  createdAt: text("created_at").notNull(),
});

export const planShares = createSharesTable("plan_shares");
