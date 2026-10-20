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
  proveSigmaPanelSql,
  type SigmaSqlProof,
  type SigmaSqlProofFailure,
} from "../server/lib/bi-migration/sigma-sql-proof.js";
import { abandonSigmaImport } from "../server/lib/bi-migration/unfinished-import.js";
import {
  createDashboardFolder,
  listDashboardFolders,
  assignDashboardToFolder,
} from "../server/lib/dashboard-folders-store.js";
import {
  DEFAULT_MAX_BYTES_TO_EXECUTE,
  verifyDashboardPanels,
  type DashboardVerification,
} from "../server/lib/dashboard-panel-verification.js";
import {
  getDashboard,
  upsertDashboard,
} from "../server/lib/dashboards-store.js";
import {
  requireSigmaSourceInspection,
  summarizeSigmaElementReview,
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

// The function is killed at 75 s with no error, which would leave the claim
// held for ten minutes. Dry runs stop launching at the deadline, and
// verification gets what is left after a margin for the writes.
const MIGRATION_DEADLINE_MS = 55_000;
const MIGRATION_WRITE_MARGIN_MS = 10_000;
const MIGRATION_VERIFICATION_BUDGET_MS = 12_000;
const MIN_VERIFICATION_BUDGET_MS = 1_000;

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

const REVIEW_MESSAGES: Record<SigmaSqlProofFailure | "unsupported", string> = {
  unsupported:
    "Review this Sigma element in the source workbook before using it.",
  query_unavailable:
    "Sigma did not return one SQL query for this element. Review it in the source workbook.",
  sql_too_large:
    "This element's SQL is too large to import. Review it in the source workbook.",
  unsafe_sql:
    "This element's SQL is not a single read-only query, so it was not imported.",
  bigquery_dry_run_failed:
    "BigQuery rejected this element's SQL with Analytics' BigQuery access.",
  bigquery_dry_run_unavailable:
    "BigQuery could not check this element's SQL during the import, so it was not imported.",
};

function makeReviewCallout(
  element: SigmaPortableElement,
  index: number,
  reason: SigmaSqlProofFailure | "unsupported",
): SqlPanel {
  return {
    id: panelId(index, element.id),
    title: safeText(element.title || "Sigma element", 200),
    sql: `SELECT 'warning' AS severity, '${REVIEW_MESSAGES[reason].replace(/'/g, "''")}' AS message`,
    source: "bigquery",
    chartType: "callout",
    width: 6,
    ...(element.tab ? { tab: safeText(element.tab, 120) } : {}),
  };
}

function diagnosticFor(
  element: SigmaPortableElement,
  status: ExternalDashboardElementDiagnostic["status"],
  reason: ExternalDashboardElementDiagnostic["reason"],
): ExternalDashboardElementDiagnostic {
  return {
    id: element.id,
    name: safeText(element.title, 200) || element.id,
    status,
    reason,
  };
}

function unsupportedReason(
  element: SigmaPortableElement,
): ExternalDashboardElementDiagnostic["reason"] {
  if (element.kind !== "unsupported") return "manual_review_required";
  const sigmaKind = element.sigmaKind.toLowerCase();
  if (sigmaKind.includes("filter")) return "unsupported_filter";
  if (sigmaKind.includes("calculation") || sigmaKind.includes("formula")) {
    return "unsupported_calculation";
  }
  return "unsupported_visualization";
}

function migrationDiagnostics(args: {
  inspection: SigmaWorkbookInspection;
  proofs: Map<string, SigmaSqlProof>;
  verification: DashboardVerification;
  panelIdsByElementId: Map<string, string>;
}): ExternalDashboardElementDiagnostic[] {
  const verificationByPanelId = new Map(
    args.verification.panels.map((panel) => [panel.panelId, panel]),
  );
  const diagnostics: ExternalDashboardElementDiagnostic[] = [];
  for (const element of args.inspection.elements) {
    const proof = args.proofs.get(element.id);
    if (!proof) {
      diagnostics.push(
        diagnosticFor(element, "red", unsupportedReason(element)),
      );
      continue;
    }
    if (!proof.ok) {
      diagnostics.push(diagnosticFor(element, "red", proof.reason));
      continue;
    }
    if (isTooExpensive(proof)) {
      diagnostics.push(diagnosticFor(element, "yellow", "too_expensive"));
      continue;
    }
    const panel = verificationByPanelId.get(
      args.panelIdsByElementId.get(element.id) ?? "",
    );
    if (panel?.status === "query-error") {
      diagnostics.push(diagnosticFor(element, "red", "query_failed"));
    } else if (panel?.status === "empty") {
      diagnostics.push(diagnosticFor(element, "yellow", "no_rows"));
    } else if (
      panel?.status === "missing-columns" ||
      panel?.status === "render-error"
    ) {
      diagnostics.push(
        diagnosticFor(element, "yellow", "manual_review_required"),
      );
    } else if (panel?.status !== "ok") {
      // Not run within the budget, over the execution cap, or never
      // reported: the panel is imported but nothing has shown it renders.
      diagnostics.push(diagnosticFor(element, "yellow", "not_verified"));
    }
  }
  return diagnostics;
}

function isTooExpensive(proof: SigmaSqlProof): boolean {
  return (
    proof.ok &&
    proof.estimatedBytes !== undefined &&
    proof.estimatedBytes > DEFAULT_MAX_BYTES_TO_EXECUTE
  );
}

function compileSigmaDashboard(args: {
  inspection: SigmaWorkbookInspection;
  proofs: Map<string, SigmaSqlProof>;
  installedAt: string;
}): {
  config: SqlDashboardConfig;
  importedCount: number;
  unsupportedCount: number;
  panelIdsByElementId: Map<string, string>;
} {
  const panels: SqlPanel[] = [];
  const panelIdsByElementId = new Map<string, string>();
  let importedCount = 0;
  let unsupportedCount = 0;

  for (const [index, element] of args.inspection.elements.entries()) {
    const proof = args.proofs.get(element.id);
    if (!proof?.ok) {
      unsupportedCount += 1;
      panels.push(
        makeReviewCallout(element, index, proof?.reason ?? "unsupported"),
      );
      continue;
    }

    importedCount += 1;
    const id = panelId(index, element.id);
    panelIdsByElementId.set(element.id, id);
    panels.push({
      id,
      title: safeText(element.title || "Sigma table", 200),
      sql: proof.sql,
      source: "bigquery",
      chartType: "table",
      width: 3,
      ...(element.tab ? { tab: safeText(element.tab, 120) } : {}),
    });
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
    panelIdsByElementId,
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

/**
 * Prove every BigQuery panel's SQL before anything is claimed or written.
 * Panels that fail become review callouts; a workbook with none that run is
 * refused.
 */
async function proveSigmaWorkbook(
  inspection: SigmaWorkbookInspection,
  deadline: number,
): Promise<Map<string, SigmaSqlProof>> {
  const candidates = summarizeSigmaElementReview({ inspection }).filter(
    (element) => element.importable,
  );
  if (candidates.length === 0) {
    fail("This Sigma workbook has no BigQuery panels to import.", {
      errorCode: "sigma_no_importable_elements",
      statusCode: 422,
    });
  }
  const proofs = await proveSigmaPanelSql(
    inspection,
    candidates.map((element) => element.id),
    { deadline },
  );
  if (![...proofs.values()].some((proof) => proof.ok)) {
    fail("None of this workbook's panels ran on Analytics' BigQuery.", {
      errorCode: "sigma_no_runnable_panels",
      statusCode: 422,
      details: {
        elements: candidates.slice(0, 20).map((element) => {
          const proof = proofs.get(element.id);
          return {
            id: element.id,
            name: safeText(element.name, 200),
            reason: proof && !proof.ok ? proof.reason : "query_unavailable",
          };
        }),
      },
    });
  }
  return proofs;
}

export default defineAction({
  description:
    "Import a Sigma workbook as a private Analytics dashboard. Each BigQuery panel's Sigma SQL is dry-run on Analytics' BigQuery; panels that run are imported as tables and the rest become review callouts. Called from the Import from Sigma dialog only; not available to the agent. Use list-sigma-workbooks and inspect-sigma-workbook to read workbooks.",
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
    const deadline = Date.now() + MIGRATION_DEADLINE_MS;
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

    const inspection = await inspectSigmaWorkbook({
      connectionId: selection.selected.id,
      workbookId: args.workbookId,
      includeSqlQueries: true,
    });
    requireSigmaSourceInspection(inspection);

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

    const proofs = await proveSigmaWorkbook(inspection, deadline);

    await createExternalDashboard({
      provider: "sigma",
      sourceId: args.workbookId,
      sourceName: inspection.workbook.name,
      sourceUpdatedAt: inspection.workbook.updatedAt,
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
        // getDashboard applies the caller's access, so a teammate gets the
        // link only when they can open the existing dashboard.
        const dashboard = migration?.targetDashboardId
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
    const id = dashboardIdFor({
      orgId: context.orgId,
      userEmail: context.userEmail,
      workbookId: args.workbookId,
    });
    try {
      const installedAt = new Date().toISOString();
      const compiled = compileSigmaDashboard({
        inspection,
        proofs,
        installedAt,
      });
      // Report only: a panel that dry-runs but fails or returns nothing is
      // still imported and flagged. Too-expensive panels are never executed.
      const verification = await verifyDashboardPanels(
        compiled.config as unknown as Record<string, unknown>,
        [...compiled.panelIdsByElementId]
          .filter(([elementId]) => {
            const proof = proofs.get(elementId);
            return proof !== undefined && !isTooExpensive(proof);
          })
          .map(([, id]) => id),
        {
          budgetMs: Math.max(
            MIN_VERIFICATION_BUDGET_MS,
            Math.min(
              MIGRATION_VERIFICATION_BUDGET_MS,
              deadline - Date.now() - MIGRATION_WRITE_MARGIN_MS,
            ),
          ),
          dryRun: false,
        },
      );
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

      const diagnostics = migrationDiagnostics({
        inspection,
        proofs,
        verification,
        panelIdsByElementId: compiled.panelIdsByElementId,
      });
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
        summary: `Imported ${compiled.importedCount} Sigma elements; ${diagnostics.length} need review.`,
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
        flaggedCount: diagnostics.length,
        _receipt,
      };
    } catch (error) {
      await abandonSigmaImport({
        workbookId: args.workbookId,
        claimToken: claim.claimToken,
        failureCode,
        dashboardId: id,
        wroteDashboard: dashboardWriteSucceeded,
        previousDashboardId: claim.record.targetDashboardId,
        ctx: { email: context.email, orgId: context.orgId },
      });
      throw error;
    }
  },
});
