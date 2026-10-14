import { defineAction, fail } from "@agent-native/core/action";
import {
  buildDeepLink,
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
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
import { getDashboard } from "../server/lib/dashboards-store.js";

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
    "List Sigma workbooks accessible to the granted Analytics Sigma connection. Returns workbook metadata, migration status, and a dashboard link only when the current user can access the private imported dashboard. Use inspect-sigma-workbook before migrate-sigma-workbook.",
  schema: listSchema,
  http: { method: "GET" },
  readOnly: true,
  mcpTool: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async (args) => {
    await requireSigmaMigrationContext();
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
    const email = getRequestUserEmail();
    const orgId = getRequestOrgId() || null;
    if (!email) {
      fail("Sign in to list Sigma workbooks.", {
        errorCode: "authentication_required",
        statusCode: 401,
      });
    }

    const workbooks = await Promise.all(
      page.workbooks.map(async (workbook) => {
        const migration = migrationBySourceId.get(workbook.workbookId);
        const status: ExternalDashboardMigrationStatus =
          migration?.status ?? "not_started";
        let dashboardId: string | undefined;
        let dashboardName: string | undefined;
        if (
          migration?.status === "migrated" &&
          migration.migratedByCurrentUser &&
          migration.targetDashboardId
        ) {
          const dashboard = await getDashboard(migration.targetDashboardId, {
            email,
            orgId,
          });
          if (dashboard?.kind === "sql") {
            dashboardId = dashboard.id;
            dashboardName = dashboard.title;
          }
        }
        return {
          id: workbook.workbookId,
          name: workbook.name,
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
          ...(migration?.flaggedCount
            ? { flaggedCount: migration.flaggedCount }
            : {}),
          ...(migration?.status === "migrated" &&
          !migration.migratedByCurrentUser
            ? { migratedByTeammate: true }
            : {}),
        };
      }),
    );

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
