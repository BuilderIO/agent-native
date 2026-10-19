import { defineAction, fail } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { z } from "zod";

import type { DashboardOrigin } from "../app/pages/adhoc/sql-dashboard/types";
import { linkExternalDashboard } from "../server/lib/bi-migration/external-dashboards-store.js";
import { getSigmaWorkbookSummary } from "../server/lib/bi-migration/sigma-adapter.js";
import { resolveSigmaConnectionSelection } from "../server/lib/bi-migration/sigma-connections.js";
import { requireSigmaMigrationContext } from "../server/lib/bi-migration/sigma-migration.js";
import {
  getDashboard,
  upsertDashboardWithRetry,
} from "../server/lib/dashboards-store.js";

const linkSchema = z.object({
  workbookId: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9_-]+$/)
    .describe("Sigma workbook id (the UUID in the workbook's API record)."),
  dashboardId: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe("Existing Analytics SQL dashboard id the caller owns."),
  connectionId: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe("Connected Sigma workspace connection, when there are several."),
});

export default defineAction({
  description:
    "Record that an existing Analytics dashboard was migrated by hand from a Sigma workbook, so Import from Sigma shows that workbook as migrated and opens this dashboard instead of importing it again. The caller must own the SQL dashboard and be able to open the workbook with their Sigma connection. Fails with external_dashboard_already_linked when the workbook is already migrated or being migrated; linking the same pair twice is a no-op. It never changes panels, sharing, or visibility.",
  schema: linkSchema,
  http: { method: "POST" },
  needsApproval: true,
  run: async (args) => {
    const context = await requireSigmaMigrationContext();
    const dashboard = await getDashboard(args.dashboardId, {
      email: context.email,
      orgId: context.orgId,
    });
    if (
      !dashboard ||
      dashboard.kind !== "sql" ||
      dashboard.orgId !== context.orgId
    ) {
      fail("Analytics dashboard not found.", {
        errorCode: "dashboard_not_found",
        statusCode: 404,
      });
    }
    if (dashboard.ownerEmail.toLowerCase() !== context.userEmail) {
      fail("Only the dashboard owner can link it to a Sigma workbook.", {
        errorCode: "dashboard_owner_required",
        statusCode: 403,
      });
    }

    // Read the workbook as the caller, so nobody links a workbook they cannot
    // see in Sigma, and so the stored name is Sigma's.
    const selection = await resolveSigmaConnectionSelection(args.connectionId);
    if (!selection.selected) {
      fail("Select a connected Sigma workspace connection first.", {
        errorCode: "sigma_connection_required",
        statusCode: 400,
      });
    }
    const workbook = await getSigmaWorkbookSummary({
      connectionId: selection.selected.id,
      workbookId: args.workbookId,
    });

    const mapping = await linkExternalDashboard({
      provider: "sigma",
      sourceId: args.workbookId,
      sourceName: workbook.name.slice(0, 200),
      targetDashboardId: dashboard.id,
    });

    const origin: DashboardOrigin = {
      provider: "sigma",
      sourceId: args.workbookId,
      sourceName: workbook.name,
      linkedAt: mapping.migratedAt ?? new Date().toISOString(),
    };
    await upsertDashboardWithRetry(
      dashboard.id,
      { email: context.email, orgId: context.orgId },
      (existing) => ({
        kind: existing.kind,
        body: { ...existing.config, origin },
      }),
    );

    return {
      status: "linked" as const,
      workbookId: args.workbookId,
      workbookName: workbook.name,
      dashboardId: dashboard.id,
      dashboardUrl: buildDeepLink({
        app: "analytics",
        view: "adhoc",
        params: { dashboardId: dashboard.id },
      }),
    };
  },
});
