import {
  createSharesTable,
  index,
  now,
  ownableColumns,
  table,
  text,
} from "../db/schema.js";

export interface DashboardStorageSchemaOptions {
  dashboardsTable?: string;
  revisionsTable?: string;
  sharesTable?: string;
}

export function createDashboardStorageSchema(
  options: DashboardStorageSchemaOptions = {},
) {
  const dashboardsTable = options.dashboardsTable ?? "dashboards";
  const revisionsTable = options.revisionsTable ?? "dashboard_revisions";
  const sharesTable = options.sharesTable ?? "dashboard_shares";

  const dashboards = table(dashboardsTable, {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    title: text("title").notNull().default("Untitled"),
    config: text("config").notNull(),
    createdAt: text("created_at").notNull().default(now()),
    updatedAt: text("updated_at").notNull().default(now()),
    updatedBy: text("updated_by"),
    archivedAt: text("archived_at"),
    ...ownableColumns(),
  });

  const dashboardShares = createSharesTable(sharesTable);

  const dashboardRevisions = table(
    revisionsTable,
    {
      id: text("id").primaryKey(),
      dashboardId: text("dashboard_id").notNull(),
      kind: text("kind").notNull(),
      title: text("title").notNull(),
      config: text("config").notNull(),
      createdAt: text("created_at").notNull().default(now()),
      createdBy: text("created_by"),
      ...ownableColumns(),
    },
    (revision) => ({
      dashboardCreatedIdx: index(`${revisionsTable}_dashboard_created_idx`).on(
        revision.dashboardId,
        revision.createdAt,
      ),
    }),
  );

  return { dashboards, dashboardRevisions, dashboardShares };
}

export type DashboardStorageSchema = ReturnType<
  typeof createDashboardStorageSchema
>;
