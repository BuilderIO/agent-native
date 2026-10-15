import { defineAction } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { z } from "zod";

import {
  listExternalDashboards,
  type ExternalDashboardMigrationStatus,
} from "../server/lib/bi-migration/external-dashboards-store.js";
import { listSigmaWorkbooks } from "../server/lib/bi-migration/sigma-adapter.js";
import { resolveSigmaConnectionSelection } from "../server/lib/bi-migration/sigma-connections.js";
import {
  requireSigmaMigrationContext,
  sigmaMigrationSetupLink,
} from "../server/lib/bi-migration/sigma-migration.js";
import { loadAccessibleDashboardMetadataByIds } from "../server/lib/dashboards-store.js";

const listSchema = z.object({
  connectionId: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe("Selected connected Sigma workspace connection, when needed."),
  page: z
    .string()
    .trim()
    .min(1)
    .max(2_000)
    .optional()
    .describe("Opaque Sigma pagination cursor returned by the previous page."),
});

export default defineAction({
  description:
    "List Sigma workbooks accessible to the granted Analytics Sigma connection. Returns workbook metadata, preview status, retry eligibility, and a dashboard link only when the current user owns and can access the imported dashboard. Sigma workbook imports remain disabled until the source project mapping can be verified.",
  schema: listSchema,
  http: { method: "GET" },
  readOnly: true,
  mcpTool: false,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async (args) => {
    const context = await requireSigmaMigrationContext();
    const selection = await resolveSigmaConnectionSelection(args.connectionId);
    const connected = selection.connections.some(
      (connection) => connection.status === "connected",
    );
    const setupUrl = sigmaMigrationSetupLink("sigma");
    if (!selection.selected) {
      return {
        connected,
        connections: selection.connections,
        requiresConnectionSelection: selection.requiresSelection,
        setupUrl,
        workbooks: [],
        nextPage: null,
      };
    }

    const page = await listSigmaWorkbooks({
      connectionId: selection.selected.id,
      page: args.page,
      limit: 100,
    });
    const migrations = await listExternalDashboards({
      provider: "sigma",
      sourceIds: page.workbooks.map((workbook) => workbook.workbookId),
      limit: 100,
    });
    const migrationBySourceId = new Map(
      migrations.map((migration) => [migration.sourceId, migration]),
    );
    const dashboardIds = migrations.flatMap((migration) =>
      migration.status === "migrated" &&
      migration.migratedByCurrentUser &&
      migration.targetDashboardId
        ? [migration.targetDashboardId]
        : [],
    );
    const dashboards = await loadAccessibleDashboardMetadataByIds(
      { email: context.userEmail, orgId: context.orgId },
      dashboardIds,
    );
    const dashboardById = new Map(
      dashboards.map((dashboard) => [dashboard.id, dashboard]),
    );

    const workbooks = page.workbooks.map((workbook) => {
      const migration = migrationBySourceId.get(workbook.workbookId);
      const status: ExternalDashboardMigrationStatus =
        migration?.status ?? "not_started";
      const migrationDashboard =
        migration?.status === "migrated" &&
        migration.migratedByCurrentUser &&
        migration.targetDashboardId
          ? dashboardById.get(migration.targetDashboardId)
          : undefined;
      let dashboardId: string | undefined;
      let dashboardName: string | undefined;
      if (
        migration?.status === "migrated" &&
        migration.migratedByCurrentUser &&
        migration.targetDashboardId
      ) {
        const dashboard = dashboardById.get(migration.targetDashboardId);
        if (
          dashboard?.kind === "sql" &&
          dashboard.ownerEmail.toLowerCase() === context.userEmail &&
          dashboard.orgId === context.orgId
        ) {
          dashboardId = dashboard.id;
          dashboardName = dashboard.title;
        }
      }
      return {
        id: workbook.workbookId,
        name: workbook.name,
        ...(typeof workbook.isArchived === "boolean"
          ? { isArchived: workbook.isArchived }
          : {}),
        ...(workbook.path ? { path: workbook.path } : {}),
        ...(workbook.updatedAt ? { updatedAt: workbook.updatedAt } : {}),
        status,
        ...(dashboardId
          ? {
              dashboardId,
              dashboardName,
              dashboardUrl: buildDeepLink({
                app: "analytics",
                view: "adhoc",
                params: { dashboardId },
              }),
            }
          : {}),
        ...(migration?.status === "migrated" &&
        migration.migratedByCurrentUser &&
        migration.targetDashboardId &&
        !migrationDashboard
          ? { canRecoverMissingDashboard: true }
          : {}),
        ...(migration?.status === "migrating" && migration.canRetryStaleClaim
          ? { canRetryStaleClaim: true }
          : {}),
        ...(migration?.flaggedCount
          ? { flaggedCount: migration.flaggedCount }
          : {}),
        retryableByCurrentUser:
          status !== "failed" || migration?.migratedByCurrentUser === true,
        ...(migration?.status === "migrated" && !migration.migratedByCurrentUser
          ? { migratedByTeammate: true }
          : {}),
      };
    });

    return {
      connected,
      connectionId: selection.selected.id,
      connectionLabel: selection.selected.label,
      connections: selection.connections,
      requiresConnectionSelection: false,
      setupUrl,
      workbooks,
      nextPage: page.nextPage,
      ...(page.total !== undefined ? { total: page.total } : {}),
    };
  },
});
