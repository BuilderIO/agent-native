import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  inspectSigmaWorkbook,
  type SigmaPortableElement,
  type SigmaWorkbookInspection,
} from "../server/lib/bi-migration/sigma-adapter.js";
import { resolveSigmaConnectionSelection } from "../server/lib/bi-migration/sigma-connections.js";
import { requireSigmaMigrationContext } from "../server/lib/bi-migration/sigma-migration.js";

const inspectSchema = z.object({
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
});

export type SigmaElementReviewReason =
  | "unsupported_element"
  | "unsupported_source"
  | "source_unavailable"
  | "source_mapping_required"
  | "query_unavailable"
  | "unsafe_sql"
  | "visualization_review";

export interface SigmaElementReview {
  id: string;
  name: string;
  type: string;
  importable: boolean;
  visualizationPreserved: boolean;
  reason?: SigmaElementReviewReason;
}

function reviewElement(
  element: SigmaPortableElement,
  inspection: SigmaWorkbookInspection,
): SigmaElementReview {
  if (element.kind !== "panel") {
    return {
      id: element.id,
      name: element.title,
      type: element.sigmaKind,
      importable: false,
      visualizationPreserved: false,
      reason: "unsupported_element",
    };
  }

  const connection = inspection.sourceConnections.find(
    (source) => source.connectionId === element.source?.connectionId,
  );
  if (!connection || connection.targetProviderCandidate !== "bigquery") {
    const sourceUnavailable = inspection.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "sigma_source_connection_unavailable" &&
        diagnostic.connectionId === element.source?.connectionId,
    );
    return {
      id: element.id,
      name: element.title,
      type: element.chartType,
      importable: false,
      visualizationPreserved: false,
      reason: sourceUnavailable ? "source_unavailable" : "unsupported_source",
    };
  }

  // Sigma reports the provider type, but the current connection API does not
  // establish that this Analytics credential points at the same project.
  return {
    id: element.id,
    name: element.title,
    type: element.chartType,
    importable: false,
    visualizationPreserved: false,
    reason: "source_mapping_required",
  };
}

export function summarizeSigmaElementReview(args: {
  inspection: SigmaWorkbookInspection;
}): SigmaElementReview[] {
  return args.inspection.elements.map((element) =>
    reviewElement(element, args.inspection),
  );
}

export function requireSigmaSourceInspection(
  inspection: SigmaWorkbookInspection,
): void {
  if (
    inspection.diagnostics.some((diagnostic) => diagnostic.severity === "error")
  ) {
    fail(
      "Sigma source connection details could not be verified. Retry the workbook preview.",
      {
        errorCode: "sigma_source_inspection_failed",
        statusCode: 503,
      },
    );
  }
}

export default defineAction({
  description:
    "Preview a Sigma workbook without returning SQL or workbook payloads. Sigma imports remain preview-only because the current connection API does not expose a BigQuery project mapping Analytics can verify.",
  schema: inspectSchema,
  http: { method: "GET" },
  readOnly: true,
  mcpTool: false,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async (args) => {
    await requireSigmaMigrationContext();
    const selection = await resolveSigmaConnectionSelection(args.connectionId);
    if (!selection.selected) {
      fail("Select a connected Sigma workspace connection first.", {
        errorCode: "sigma_connection_required",
        statusCode: 400,
      });
    }
    const inspection = await inspectSigmaWorkbook({
      connectionId: selection.selected.id,
      workbookId: args.workbookId,
      includeSqlQueries: false,
    });
    requireSigmaSourceInspection(inspection);
    const elements = summarizeSigmaElementReview({
      inspection,
    });
    const importableCount = elements.filter(
      (element) => element.importable,
    ).length;
    const unsupportedCount = elements.length - importableCount;
    const reviewRequiredCount = elements.filter(
      (element) =>
        !element.importable || element.reason === "visualization_review",
    ).length;
    const sourceMappingRequiredCount = elements.filter(
      (element) => element.reason === "source_mapping_required",
    ).length;
    return {
      workbook: {
        id: inspection.workbook.workbookId,
        name: inspection.workbook.name,
        updatedAt: inspection.workbook.updatedAt,
      },
      connectionId: selection.selected.id,
      connectionLabel: selection.selected.label,
      importableCount,
      unsupportedCount,
      reviewRequiredCount,
      sourceMappingRequiredCount,
      elements,
      betaRepresentationWarning: true,
    };
  },
});
