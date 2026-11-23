import {
  bigint,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
} from "drizzle-orm/pg-core";

import type {
  NotebookEvent,
  OperationReceipt,
} from "../../../shared/notebook-operations.js";
import { projects } from "../../db/schema.js";

export const notebookProjectColumns = {
  notebookVersionId: text("notebook_version_id"),
  notebookRevision: bigint("notebook_revision", { mode: "bigint" })
    .notNull()
    .default(0n),
  notebookEventSeq: bigint("notebook_event_seq", { mode: "bigint" })
    .notNull()
    .default(0n),
  notebookOrderRevision: bigint("notebook_order_revision", { mode: "bigint" })
    .notNull()
    .default(0n),
  notebookMetadataRevision: bigint("notebook_metadata_revision", {
    mode: "bigint",
  })
    .notNull()
    .default(0n),
  notebookInputRevision: bigint("notebook_input_revision", { mode: "bigint" })
    .notNull()
    .default(0n),
  notebookLayoutRevision: bigint("notebook_layout_revision", { mode: "bigint" })
    .notNull()
    .default(0n),
};

export const notebookCellColumns = {
  notebookRevision: bigint("notebook_revision", { mode: "bigint" })
    .notNull()
    .default(0n),
  notebookLabelRevision: bigint("notebook_label_revision", { mode: "bigint" })
    .notNull()
    .default(0n),
};

export const notebookTombstones = pgTable(
  "analytics2_notebook_tombstones",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    cellId: text("cell_id").notNull(),
    versionId: text("version_id").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    outputGeneration: text("output_generation").notNull(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.cellId] })],
);

export const notebookReceipts = pgTable(
  "analytics2_notebook_receipts",
  {
    orgId: text("org_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    principalId: text("principal_id").notNull(),
    opId: text("op_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    receipt: jsonb("receipt").$type<OperationReceipt>().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.orgId, table.projectId, table.principalId, table.opId],
    }),
    index("analytics2_notebook_receipts_project_idx").on(table.projectId),
  ],
);

export const notebookEvents = pgTable(
  "analytics2_notebook_events",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    eventSeq: bigint("event_seq", { mode: "bigint" }).notNull(),
    event: jsonb("event").$type<NotebookEvent>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.eventSeq] })],
);
