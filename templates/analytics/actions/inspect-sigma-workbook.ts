import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

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
  | "analytics_bigquery_required"
  | "unsupported_source"
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
  analyticsBigQueryReady: boolean,
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

  if (!analyticsBigQueryReady) {
    return {
      id: element.id,
      name: element.title,
      type: element.chartType,
      importable: false,
      visualizationPreserved: false,
      reason: "analytics_bigquery_required",
    };
  }

  const connection = inspection.sourceConnections.find(
    (source) => source.connectionId === element.source?.connectionId,
  );
  if (!connection || connection.targetProviderCandidate !== "bigquery") {
    return {
      id: element.id,
      name: element.title,
      type: element.chartType,
      importable: false,
      visualizationPreserved: false,
      reason: "unsupported_source",
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
  analyticsBigQueryReady: boolean;
}): SigmaElementReview[] {
  return args.inspection.elements.map((element) =>
    reviewElement(element, args.inspection, args.analyticsBigQueryReady),
  );
}

export default defineAction({
  description:
    "Inspect a Sigma workbook before import. Returns element names, source compatibility, and review warnings without returning SQL or workbook payloads. BigQuery elements stay blocked until Analytics can verify the Sigma source project mapping.",
  schema: inspectSchema,
  http: { method: "GET" },
  readOnly: true,
  mcpTool: false,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async (args) => {
    const context = await requireSigmaMigrationContext();
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
    });
    const analyticsBigQueryReady = await hasAnalyticsBigQuerySource(context);
    const elements = summarizeSigmaElementReview({
      inspection,
      analyticsBigQueryReady,
    });
    const importableCount = elements.filter(
      (element) => element.importable,
    ).length;
    const unsupportedCount = elements.length - importableCount;
    const reviewRequiredCount = elements.filter(
      (element) =>
        !element.importable || element.reason === "visualization_review",
    ).length;
    return {
      workbook: {
        id: inspection.workbook.workbookId,
        name: inspection.workbook.name,
        updatedAt: inspection.workbook.updatedAt,
      },
      connectionId: selection.selected.id,
      connectionLabel: selection.selected.label,
      analyticsBigQueryReady,
      bigQuerySetupUrl: sigmaMigrationSetupLink("bigquery"),
      importableCount,
      unsupportedCount,
      reviewRequiredCount,
      elements,
      betaRepresentationWarning: true,
    };
  },
});
