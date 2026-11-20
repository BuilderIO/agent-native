import { callAction } from "@agent-native/core/client/hooks";
import {
  parseAnalyticsPanelLink,
  type AnalyticsPanelCaptureRequest,
} from "@agent-native/core/shared";
import {
  ANALYTICS_CHART_BLOCK_TYPE,
  analyticsChartBlockRaw,
  type AnalyticsChartData,
} from "@shared/analytics-chart-block";

import {
  createSourceLinkPaste,
  type SourceLinkPasteContext,
  type SourceLinkPasteOptions,
} from "../source-link-paste";

export type AnalyticsChartPasteContext = SourceLinkPasteContext;
export type AnalyticsChartPasteOptions = SourceLinkPasteOptions;

type CaptureResult =
  | {
      status: "captured";
      blockId: string;
      chart: AnalyticsChartData;
    }
  | {
      status: "needs_confirmation";
      blockId: string;
      chart: AnalyticsChartData;
    };

/** The panel a paste names, when it is exactly one Analytics panel link. */
export function analyticsPanelLinkFromPaste(
  text: string,
  origins: readonly string[],
): AnalyticsPanelCaptureRequest | null {
  if (origins.length === 0) return null;
  return parseAnalyticsPanelLink(text, origins);
}

export const AnalyticsChartPaste =
  createSourceLinkPaste<AnalyticsPanelCaptureRequest>({
    name: "analyticsChartPaste",
    blockType: ANALYTICS_CHART_BLOCK_TYPE,
    parse: analyticsPanelLinkFromPaste,
    capture: async ({ documentId, t }, request, acknowledgeWiderAudience) => {
      const result = (await callAction("capture-analytics-chart", {
        documentId,
        ...request,
        purpose: "insert",
        ...(acknowledgeWiderAudience ? { acknowledgeWiderAudience } : {}),
      })) as CaptureResult;
      return result.status === "needs_confirmation"
        ? {
            status: "needs_confirmation",
            message: t("analyticsChart.confirmWider", {
              dashboard: result.chart.dashboard.title,
            }),
          }
        : {
            status: "captured",
            blockId: result.blockId,
            raw: analyticsChartBlockRaw(result.blockId, result.chart),
          };
    },
    messages: {
      adding: "analyticsChart.adding",
      added: "analyticsChart.added",
      addFailed: "analyticsChart.addFailed",
      addAnyway: "analyticsChart.addAnyway",
      keepLink: "analyticsChart.keepLink",
    },
  });
