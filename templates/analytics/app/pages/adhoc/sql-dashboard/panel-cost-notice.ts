import { callAction } from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

const MIB = 1024 ** 2;
const GIB = 1024 ** 3;
const TIB = 1024 ** 4;
const NOTICE_MS = 8000;

type Formatters = ReturnType<typeof useFormatters>;

export function formatScanSize(bytes: number, formatters: Formatters): string {
  const [value, unit] =
    bytes >= TIB
      ? [bytes / TIB, "TiB"]
      : bytes >= GIB
        ? [bytes / GIB, "GiB"]
        : [bytes / MIB, "MiB"];
  return `${formatters.formatNumber(value, { maximumFractionDigits: 1 })} ${unit}`;
}

export function formatQueryUsd(usd: number, formatters: Formatters): string {
  const money = (value: number) =>
    formatters.formatNumber(value, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    });
  return usd > 0 && usd < 0.01 ? `<${money(0.01)}` : money(usd);
}

async function estimatePanel(dashboardId: string, panelId: string) {
  try {
    return await callAction("estimate-query-cost", { dashboardId, panelId });
  } catch {
    // coercion-ok: the notice is informational; a failed estimate leaves the save as it was.
    return null;
  }
}

/**
 * After a save that changed a panel's query, shows what one refresh of that
 * panel scans and costs in BigQuery, from the same free dry run as
 * estimate-query-cost. Panels outside BigQuery, and estimates that fail, show
 * nothing, and so does an estimate a newer save of the panel has replaced. Over
 * the per-run or per-month threshold the notice stays up until dismissed or
 * until you leave the dashboard.
 */
export function usePanelCostNotice(dashboardId: string | undefined) {
  const t = useT();
  const formatters = useFormatters();
  // An estimate that lands after leaving the dashboard must not show there,
  // and its warnings close when you leave.
  const openDashboardRef = useRef(dashboardId);
  const warningsRef = useRef(new Set<string>());
  useEffect(() => {
    openDashboardRef.current = dashboardId;
    const warnings = warningsRef.current;
    return () => {
      for (const id of warnings) toast.dismiss(id);
      warnings.clear();
    };
  }, [dashboardId]);
  // Nor may one that lands after a newer save of the same panel.
  const latestRequestRef = useRef(new Map<string, number>());
  const requestCountRef = useRef(0);

  return useCallback(
    async (panelId: string, title: string) => {
      if (!dashboardId) return;
      const key = `${dashboardId}:${panelId}`;
      const request = ++requestCountRef.current;
      latestRequestRef.current.set(key, request);
      const result = await estimatePanel(dashboardId, panelId);
      if (
        !result ||
        openDashboardRef.current !== dashboardId ||
        latestRequestRef.current.get(key) !== request
      ) {
        return;
      }
      const estimate = "panels" in result ? result.panels[0] : undefined;
      if (estimate?.status !== "estimated") return;
      const over =
        estimate.overPerRunThreshold || estimate.overPerMonthThreshold;
      const values = {
        size: formatScanSize(estimate.estimatedBytes, formatters),
        perRun: formatQueryUsd(estimate.usdPerRun, formatters),
        perMonth:
          estimate.usdPerMonth === null
            ? ""
            : formatQueryUsd(estimate.usdPerMonth, formatters),
      };
      const cost = t(
        estimate.usdPerMonth === null
          ? "sqlDashboard.panelCostUnscheduled"
          : "sqlDashboard.panelCostScheduled",
        values,
      );
      const options = {
        id: `panel-cost:${dashboardId}:${panelId}`,
        // The hint goes on its own line under the cost.
        description: over
          ? `${cost}\n${t("sqlDashboard.panelCostOverHint")}`
          : cost,
        classNames: { description: "whitespace-pre-line" },
        duration: over ? Number.POSITIVE_INFINITY : NOTICE_MS,
        closeButton: over,
      };
      if (over) {
        warningsRef.current.add(options.id);
        toast.warning(t("sqlDashboard.panelCostOverTitle", { title }), options);
      } else {
        toast.message(t("sqlDashboard.panelCostTitle", { title }), options);
      }
    },
    [dashboardId, formatters, t],
  );
}
