import { createHash } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import type { WriteReceipt } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { z } from "zod";

import type {
  SqlDashboardConfig,
  SqlPanel,
} from "../app/pages/adhoc/sql-dashboard/types.js";
import {
  claimExternalDashboard,
  boundExternalDashboardDiagnostics,
  completeExternalDashboard,
  createExternalDashboard,
  failExternalDashboard,
  listExternalDashboards,
  type ExternalDashboardElementDiagnostic,
} from "../server/lib/bi-migration/external-dashboards-store.js";
import {
  inspectSigmaWorkbook,
  type SigmaPortableElement,
  type SigmaWorkbookInspection,
} from "../server/lib/bi-migration/sigma-adapter.js";
import { resolveSigmaConnectionSelection } from "../server/lib/bi-migration/sigma-connections.js";
import {
  hasAnalyticsBigQuerySource,
  requireSigmaMigrationContext,
  sigmaMigrationSetupLink,
} from "../server/lib/bi-migration/sigma-migration.js";
import {
  createDashboardFolder,
  listDashboardFolders,
  assignDashboardToFolder,
} from "../server/lib/dashboard-folders-store.js";
import {
  getDashboard,
  upsertDashboard,
} from "../server/lib/dashboards-store.js";
import { assertReadOnlySql } from "../server/lib/read-only-sql.js";
import {
  requireSigmaSourceInspection,
  summarizeSigmaElementReview,
  type SigmaElementReview,
} from "./inspect-sigma-workbook.js";

const migrateSchema = z.object({
  workbookId: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9_-]+$/)
    .describe("Sigma workbook ID returned by list-sigma-workbooks."),
  connectionId: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe("Selected connected Sigma workspace connection, when needed."),
  remigrate: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Set true only when intentionally replacing this user's prior imported dashboard with a fresh source snapshot.",
    ),
  recoverMissingDashboard: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Set true only when the prior imported dashboard is no longer accessible and should be recreated.",
    ),
});

function dashboardIdFor(args: {
  orgId: string;
  userEmail: string;
  workbookId: string;
}): string {
  const digest = createHash("sha256")
    .update(`${args.orgId}\n${args.userEmail}\n${args.workbookId}`)
    .digest("hex")
    .slice(0, 36);
  return `sigma-${digest}`;
}

function panelId(index: number, sourceElementId: string): string {
  const digest = createHash("sha256").update(sourceElementId).digest("hex");
  return `sigma-${index + 1}-${digest.slice(0, 12)}`;
}

function safeText(value: string, maxLength = 180): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function sigmaDashboardName(workbookName: string, workbookId: string) {
  const sourceKey = createHash("sha256").update(workbookId).digest("hex");
  return `Sigma: ${safeText(workbookName, 150)} · ${sourceKey.slice(0, 20)}`;
}

function makeReviewCallout(
  element: SigmaPortableElement,
  index: number,
  tab?: string,
): SqlPanel {
  return {
    id: panelId(index, element.id),
    title: safeText(element.title || "Sigma element", 200),
    sql: "SELECT 'warning' AS severity, 'Review this Sigma element in the source workbook before using it.' AS message",
    source: "bigquery",
    chartType: "callout",
    width: 6,
    ...(tab ? { tab } : {}),
  };
}

function panelTab(element: SigmaPortableElement): string | undefined {
  return element.kind === "panel" ? element.tab : element.tab;
}

function uniqueQueriesByElementId(
  inspection: SigmaWorkbookInspection,
): Map<string, string | null> {
  const queries = new Map<string, string | null>();
  for (const query of inspection.sqlQueries) {
    if (!query.elementId) continue;
    queries.set(
      query.elementId,
      queries.has(query.elementId) ? null : (query.sql ?? null),
    );
  }
  return queries;
}

function migrationDiagnostics(
  inspection: SigmaWorkbookInspection,
  review: ReturnType<typeof summarizeSigmaElementReview>,
): ExternalDashboardElementDiagnostic[] {
  const reasonsById = new Map(review.map((element) => [element.id, element]));
  const diagnostics: ExternalDashboardElementDiagnostic[] = [];
  for (const element of inspection.elements) {
    const result = reasonsById.get(element.id);
    if (element.kind === "unsupported") {
      const sigmaKind = element.sigmaKind.toLowerCase();
      const reason: ExternalDashboardElementDiagnostic["reason"] =
        sigmaKind.includes("filter")
          ? "unsupported_filter"
          : sigmaKind.includes("calculation") || sigmaKind.includes("formula")
            ? "unsupported_calculation"
            : "unsupported_visualization";
      diagnostics.push({
        id: element.id,
        name: safeText(element.title, 200) || element.id,
        status: "red",
        reason,
      });
      continue;
    }
    if (!result?.importable) {
      diagnostics.push({
        id: element.id,
        name: safeText(element.title, 200) || element.id,
        status: "red",
        reason:
          result?.reason === "query_unavailable" ||
          result?.reason === "unsafe_sql"
            ? "query_unavailable"
            : "manual_review_required",
      });
      continue;
    }
    if (!result.reason) continue;
    diagnostics.push({
      id: element.id,
      name: safeText(element.title, 200) || element.id,
      status: "yellow",
      reason: "manual_review_required",
    });
  }
  return diagnostics;
}

function compileSigmaDashboard(args: {
  inspection: SigmaWorkbookInspection;
  review: ReturnType<typeof summarizeSigmaElementReview>;
  installedAt: string;
}): {
  config: SqlDashboardConfig;
  importedCount: number;
  unsupportedCount: number;
} {
  const reviewById = new Map(
    args.review.map((element) => [element.id, element]),
  );
  const queriesByElementId = uniqueQueriesByElementId(args.inspection);
  const panels: SqlPanel[] = [];
  let importedCount = 0;
  let unsupportedCount = 0;

  for (const [index, element] of args.inspection.elements.entries()) {
    const review = reviewById.get(element.id);
    if (element.kind !== "panel" || !review?.importable) {
      unsupportedCount += 1;
      panels.push(makeReviewCallout(element, index, panelTab(element)));
      continue;
    }

    const sql = queriesByElementId.get(element.id);
    if (!sql) {
      unsupportedCount += 1;
      panels.push(makeReviewCallout(element, index, panelTab(element)));
      continue;
    }
    try {
      assertReadOnlySql(sql, "bigquery");
    } catch {
      unsupportedCount += 1;
      panels.push(makeReviewCallout(element, index, panelTab(element)));
      continue;
    }

    importedCount += 1;
    panels.push({
      id: panelId(index, element.id),
      title: safeText(element.title || "Sigma table", 200),
      sql,
      source: "bigquery",
      chartType: "table",
      width: 3,
      ...(element.tab ? { tab: safeText(element.tab, 120) } : {}),
    });
  }

  if (panels.length === 0) {
    panels.push({
      id: "sigma-empty",
      title: "Sigma import review",
      sql: "SELECT 'warning' AS severity, 'This Sigma workbook contains no elements that can be imported.' AS message",
      source: "bigquery",
      chartType: "callout",
      width: 6,
    });
    unsupportedCount = 1;
  }

  const sourceVersion =
    args.inspection.workbook.latestVersion ??
    args.inspection.workbook.documentVersion;
  return {
    config: {
      name: sigmaDashboardName(
        args.inspection.workbook.name,
        args.inspection.workbook.workbookId,
      ),
      columns: 6,
      catalog: {
        templateId: `sigma-${createHash("sha256")
          .update(args.inspection.workbook.workbookId)
          .digest("hex")
          .slice(0, 24)}`,
        ...(sourceVersion !== undefined
          ? { templateVersion: String(sourceVersion) }
          : {}),
        installedAt: args.installedAt,
      },
      panels,
    },
    importedCount,
    unsupportedCount,
  };
}

async function ensureSigmaFolder(context: {
  email: string;
  orgId: string | null;
}) {
  const folders = await listDashboardFolders(context);
  const folder = folders.find(
    (candidate) =>
      candidate.scope === "personal" &&
      candidate.ownerEmail.toLowerCase() === context.email.toLowerCase() &&
      candidate.name.trim().toLowerCase() === "sigma",
  );
  if (folder) return folder;
  return createDashboardFolder("Sigma", "personal", context);
}

function dashboardUrl(dashboardId: string): string {
  return buildDeepLink({
    app: "analytics",
    view: "adhoc",
    params: { dashboardId },
  });
}

function requireImportableSigmaReview(
  inspection: SigmaWorkbookInspection,
): SigmaElementReview[] {
  const review = summarizeSigmaElementReview({ inspection });
  if (review.some((element) => element.reason === "source_mapping_required")) {
    fail(
      "Sigma does not expose a BigQuery project mapping Analytics can verify, so this workbook's SQL cannot be imported yet.",
      {
        errorCode: "sigma_source_mapping_required",
        statusCode: 409,
        details: { setupUrl: sigmaMigrationSetupLink("bigquery") },
      },
    );
  }
  if (!review.some((element) => element.importable)) {
    fail("This Sigma workbook has no elements that can be imported.", {
      errorCode: "sigma_no_importable_elements",
      statusCode: 422,
    });
  }
  return review;
}

export default defineAction({
  description:
    "Reserved for Sigma workbook imports after Analytics can verify the Sigma BigQuery source-project mapping. The current Sigma API does not expose that mapping, so this action remains fail-closed and is not available to the agent; use list-sigma-workbooks and inspect-sigma-workbook for the read-only preview.",
  schema: migrateSchema,
  http: { method: "POST" },
  agentTool: false,
  needsApproval: true,
  mcpTool: false,
  publicAgent: { expose: false, readOnly: false, requiresAuth: true },
  link: ({ result }) => {
    const dashboardId =
      result && typeof result === "object"
        ? (result as { dashboardId?: string }).dashboardId
        : undefined;
    if (!dashboardId) return null;
    return {
      url: dashboardUrl(dashboardId),
      label: "Open imported Analytics dashboard",
      view: "adhoc",
    };
  },
  run: async (args) => {
    const context = await requireSigmaMigrationContext();
    const selection = await resolveSigmaConnectionSelection(args.connectionId);
    if (!selection.selected) {
      fail("Select a connected Sigma workspace connection first.", {
        errorCode: "sigma_connection_required",
        statusCode: 400,
      });
    }
    if (!(await hasAnalyticsBigQuerySource(context))) {
      fail("Connect an Analytics BigQuery source before importing Sigma SQL.", {
        errorCode: "analytics_bigquery_required",
        statusCode: 409,
        details: { setupUrl: sigmaMigrationSetupLink("bigquery") },
      });
    }

    const preliminaryInspection = await inspectSigmaWorkbook({
      connectionId: selection.selected.id,
      workbookId: args.workbookId,
      includeSqlQueries: false,
    });
    requireSigmaSourceInspection(preliminaryInspection);
    requireImportableSigmaReview(preliminaryInspection);
    const inspection = await inspectSigmaWorkbook({
      connectionId: selection.selected.id,
      workbookId: args.workbookId,
      includeSqlQueries: true,
    });
    requireSigmaSourceInspection(inspection);
    const review = requireImportableSigmaReview(inspection);

    if (args.recoverMissingDashboard) {
      if (args.remigrate) {
        fail(
          "Choose either missing-dashboard recovery or an intentional remigration.",
          { errorCode: "sigma_recovery_mode_conflict", statusCode: 400 },
        );
      }
      const [migration] = await listExternalDashboards({
        provider: "sigma",
        sourceIds: [args.workbookId],
        limit: 1,
      });
      const expectedDashboardId = dashboardIdFor({
        orgId: context.orgId,
        userEmail: context.userEmail,
        workbookId: args.workbookId,
      });
      if (
        migration?.status !== "migrated" ||
        !migration.migratedByCurrentUser ||
        migration.targetDashboardId !== expectedDashboardId ||
        (await getDashboard(expectedDashboardId, {
          email: context.email,
          orgId: context.orgId,
        }))
      ) {
        fail(
          "The prior Sigma dashboard is still available or cannot be recovered by this user.",
          {
            errorCode: "sigma_dashboard_recovery_unavailable",
            statusCode: 409,
          },
        );
      }
    }

    await createExternalDashboard({
      provider: "sigma",
      sourceId: args.workbookId,
      sourceName: preliminaryInspection.workbook.name,
      sourceUpdatedAt: preliminaryInspection.workbook.updatedAt,
    });
    const claim = await claimExternalDashboard({
      provider: "sigma",
      sourceId: args.workbookId,
      remigrate: args.remigrate || args.recoverMissingDashboard,
    });
    if (!claim.claimed) {
      if (claim.reason === "already_migrated") {
        const [migration] = await listExternalDashboards({
          provider: "sigma",
          sourceIds: [args.workbookId],
          limit: 1,
        });
        const dashboard =
          migration?.migratedByCurrentUser && migration.targetDashboardId
            ? await getDashboard(migration.targetDashboardId, {
                email: context.email,
                orgId: context.orgId,
              })
            : null;
        return {
          status: "already_migrated" as const,
          ...(dashboard?.kind === "sql"
            ? {
                dashboardId: dashboard.id,
                dashboardName: dashboard.title,
                dashboardUrl: dashboardUrl(dashboard.id),
              }
            : {}),
        };
      }
      return { status: "in_progress" as const };
    }

    let failureCode: "dashboard_write_failed" | "verification_failed" =
      "dashboard_write_failed";
    let dashboardWriteSucceeded = false;
    try {
      const installedAt = new Date().toISOString();
      const compiled = compileSigmaDashboard({
        inspection,
        review,
        installedAt,
      });
      const id = dashboardIdFor({
        orgId: context.orgId,
        userEmail: context.userEmail,
        workbookId: args.workbookId,
      });
      const existing = await getDashboard(id, {
        email: context.email,
        orgId: context.orgId,
      });
      if (
        existing &&
        (existing.ownerEmail.toLowerCase() !== context.userEmail ||
          existing.visibility !== "private" ||
          existing.orgId !== context.orgId)
      ) {
        fail("A private dashboard already uses this migration ID.", {
          errorCode: "dashboard_id_conflict",
          statusCode: 409,
        });
      }
      if (args.recoverMissingDashboard && existing) {
        fail(
          "The prior Sigma dashboard became available before recovery completed.",
          { errorCode: "sigma_dashboard_recovery_conflict", statusCode: 409 },
        );
      }

      const folder = await ensureSigmaFolder({
        email: context.email,
        orgId: context.orgId,
      });
      await upsertDashboard(
        id,
        "sql",
        compiled.config as unknown as Record<string, unknown>,
        { email: context.email, orgId: context.orgId },
      );
      dashboardWriteSucceeded = true;
      await assignDashboardToFolder(id, folder.id, {
        email: context.email,
        orgId: context.orgId,
      });
      const saved = await getDashboard(id, {
        email: context.email,
        orgId: context.orgId,
      });
      if (
        !saved ||
        saved.kind !== "sql" ||
        saved.visibility !== "private" ||
        saved.ownerEmail.toLowerCase() !== context.userEmail ||
        saved.orgId !== context.orgId ||
        saved.config.name !== compiled.config.name
      ) {
        failureCode = "verification_failed";
        fail(
          "Analytics did not return the private Sigma dashboard for verification.",
          {
            errorCode: "sigma_dashboard_verification_failed",
            statusCode: 500,
          },
        );
      }

      const diagnostics = migrationDiagnostics(inspection, review);
      const storedDiagnostics = boundExternalDashboardDiagnostics(diagnostics);
      await completeExternalDashboard({
        provider: "sigma",
        sourceId: args.workbookId,
        claimToken: claim.claimToken,
        targetDashboardId: id,
        ...storedDiagnostics,
      });
      const _receipt: WriteReceipt = {
        changed: true,
        verified: true,
        subject: `dashboard:${id}`,
        summary: `Imported ${compiled.importedCount} Sigma elements; ${compiled.unsupportedCount} need manual review.`,
        checks: [
          {
            id: "sigma-dashboard-readable",
            ok: saved.kind === "sql",
            detail: `Private dashboard ${id} is readable by its importer.`,
          },
        ],
      };
      return {
        status: "completed" as const,
        dashboardId: id,
        dashboardName: saved.title,
        dashboardUrl: dashboardUrl(id),
        importedCount: compiled.importedCount,
        unsupportedCount: compiled.unsupportedCount,
        reviewRequiredCount: diagnostics.length,
        flaggedCount: diagnostics.length,
        _receipt,
      };
    } catch (error) {
      await failExternalDashboard({
        provider: "sigma",
        sourceId: args.workbookId,
        claimToken: claim.claimToken,
        failureCode,
        preservePreviousMigration: !dashboardWriteSucceeded,
      });
      throw error;
    }
  },
});
