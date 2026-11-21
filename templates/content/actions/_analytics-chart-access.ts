import type { EmbedVisibility } from "@agent-native/core/shared";

import {
  authorizeEmbedPage,
  embedDocumentIdSchema,
  visibilityForPageOrganization,
  type EmbedPage,
} from "./_embed-page-access.js";

export const analyticsChartDocumentIdSchema = embedDocumentIdSchema;

export async function authorizeAnalyticsChartPage(
  documentId: string,
  role: "viewer" | "editor",
): Promise<EmbedPage> {
  return authorizeEmbedPage(documentId, role, {
    signedOut: {
      message: "Sign in to use Analytics charts.",
      errorCode: "analytics_chart_signed_out",
    },
    editRequired: {
      message:
        "Only the page's editors can add or refresh its Analytics charts.",
      errorCode: "analytics_chart_edit_required",
    },
  });
}

export function chartForPageOrganization<
  Chart extends { dashboard: { visibility: EmbedVisibility } },
>(chart: Chart, page: Pick<EmbedPage, "orgId" | "authorityOrgId">): Chart {
  const visibility = visibilityForPageOrganization(
    chart.dashboard.visibility,
    page,
  );
  return visibility === chart.dashboard.visibility
    ? chart
    : { ...chart, dashboard: { ...chart.dashboard, visibility } };
}
