import { sql } from "@agent-native/core/db/schema";
import {
  bigint,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type {
  NotebookCell,
  NotebookChange,
  NotebookResources,
} from "../../shared/notebook-operations.js";
import type { NotebookProposalView } from "../../shared/notebook-proposals.js";
import type { DraftHead } from "../../shared/notebook-snapshot-contract.js";

export type NotebookToolIdentity = {
  runId: string;
  turnId: string;
  toolCallId: string;
  ordinal?: number;
};

export type CellProposalChange = Exclude<
  NotebookChange,
  { type: "set-metadata" | "set-app" }
>;

export const notebookThreadProjects = pgTable(
  "analytics2_thread_projects",
  {
    id: text("binding_id").primaryKey(),
    orgId: text("org_id").notNull(),
    appId: text("app_id").notNull(),
    threadId: text("thread_id").notNull(),
    projectId: text("project_id").notNull(),
    workingVersionId: text("working_version_id").notNull(),
    kind: text("kind", { enum: ["ask", "notebook", "app", "magic"] }).notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    overlayRevision: bigint("overlay_revision", { mode: "bigint" })
      .notNull()
      .default(0n),
    eventCursor: bigint("event_cursor", { mode: "bigint" })
      .notNull()
      .default(0n),
    endedAt: text("ended_at"),
  },
  (table) => [
    uniqueIndex("analytics2_thread_projects_live_uq")
      .on(table.orgId, table.appId, table.threadId)
      .where(sql`${table.endedAt} is null`),
    index("analytics2_thread_projects_project_idx").on(
      table.orgId,
      table.appId,
      table.projectId,
    ),
  ],
);

export const notebookProposals = pgTable(
  "analytics2_notebook_proposals",
  {
    id: text("id").primaryKey(),
    bindingId: text("binding_id")
      .notNull()
      .references(() => notebookThreadProjects.id, { onDelete: "cascade" }),
    cellId: text("cell_id").notNull(),
    sequence: bigint("proposal_seq", { mode: "bigint" }).notNull(),
    eventSeq: bigint("event_seq", { mode: "bigint" }).notNull(),
    baseHead: jsonb("base_head").$type<DraftHead>().notNull(),
    firstBefore: jsonb("first_before").$type<NotebookCell>(),
    firstResources: jsonb("first_resources")
      .$type<NotebookResources>()
      .notNull(),
    after: jsonb("after_projection").$type<NotebookCell>(),
    changes: jsonb("changes")
      .$type<{ sequence: string; change: CellProposalChange }[]>()
      .notNull(),
    dependencyIds: jsonb("dependency_ids").$type<string[]>().notNull(),
    kind: text("kind").$type<NotebookProposalView["kind"]>().notNull(),
    status: text("status").$type<NotebookProposalView["status"]>().notNull(),
    runIntentId: text("run_intent_id"),
    decidedBy: text("decided_by"),
    decidedAt: text("decided_at"),
  },
  (table) => [
    index("analytics2_notebook_proposals_active_idx").on(
      table.bindingId,
      table.status,
      table.sequence,
    ),
    index("analytics2_notebook_proposals_cursor_idx").on(
      table.bindingId,
      table.eventSeq,
    ),
  ],
);

export const notebookProposalReceipts = pgTable(
  "analytics2_notebook_proposal_receipts",
  {
    bindingId: text("binding_id")
      .notNull()
      .references(() => notebookThreadProjects.id, { onDelete: "cascade" }),
    actorId: text("actor_id").notNull(),
    opId: text("op_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    receipt: jsonb("receipt").notNull(),
    toolIdentity: jsonb("tool_identity").$type<NotebookToolIdentity>(),
    overlayRevision: bigint("overlay_revision", { mode: "bigint" }).notNull(),
    eventCursor: bigint("event_cursor", { mode: "bigint" }).notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.bindingId, table.actorId, table.opId] }),
    uniqueIndex("analytics2_notebook_proposal_receipts_revision_uq").on(
      table.bindingId,
      table.overlayRevision,
    ),
    index("analytics2_notebook_proposal_receipts_cursor_idx").on(
      table.bindingId,
      table.eventCursor,
    ),
  ],
);

export const notebookLegacyProposalDispositions = pgTable(
  "analytics2_notebook_legacy_proposal_dispositions",
  {
    projectId: text("project_id").notNull(),
    workingVersionId: text("working_version_id").notNull(),
    cellId: text("cell_id").notNull(),
    legacyId: text("legacy_id").notNull(),
    actorId: text("actor_id").notNull(),
    opId: text("op_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    receipt: jsonb("receipt").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.projectId,
        table.workingVersionId,
        table.cellId,
        table.legacyId,
      ],
    }),
    uniqueIndex("analytics2_notebook_legacy_proposal_op_uq").on(
      table.projectId,
      table.actorId,
      table.opId,
    ),
  ],
);
