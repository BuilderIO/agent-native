import type {
  SqlDashboardConfig,
  SqlPanel,
} from "../../app/pages/adhoc/sql-dashboard/types";

export const NATIVE_V2_DASHBOARD_VERSION = "2026-07-30-v1";

export const NATIVE_V2_DASHBOARD_IDS = [
  "customer-roi-v2",
  "account-engagement-v2",
  "cross-sell-v2",
  "win-loss-v2",
] as const;

export type NativeV2DashboardId = (typeof NATIVE_V2_DASHBOARD_IDS)[number];

export type NativeV2BindingKey =
  | "roi.kpi"
  | "roi.trend"
  | "roi.detail"
  | "engagement.kpi"
  | "engagement.trend"
  | "engagement.heatmap"
  | "engagement.alerts"
  | "cross_sell.funnel"
  | "cross_sell.kpi"
  | "cross_sell.pipeline"
  | "cross_sell.trend"
  | "win_loss.summary"
  | "win_loss.reasons"
  | "win_loss.evidence"
  | "win_loss.alerts";

export interface NativeV2Binding {
  programId: string;
  params?: Record<string, unknown>;
}

export interface NativeV2PanelManifest {
  id: string;
  title: string;
  bindingKey?: NativeV2BindingKey;
  chartType: SqlPanel["chartType"];
  width: number;
  columns?: number;
  tab?: string;
  config?: SqlPanel["config"];
  requiredColumns?: string[];
}

export interface NativeV2DashboardManifest {
  id: NativeV2DashboardId;
  name: string;
  description: string;
  category: "Acquisition" | "Product" | "Operations";
  tags: string[];
  requiredBindings: NativeV2BindingKey[];
  panels: NativeV2PanelManifest[];
}

const section = (
  id: string,
  title: string,
  tab: string,
  columns = 6,
): NativeV2PanelManifest => ({
  id,
  title,
  chartType: "section",
  width: 1,
  columns,
  tab,
});

const boundPanel = (
  panel: Omit<NativeV2PanelManifest, "bindingKey"> & {
    bindingKey: NativeV2BindingKey;
    requiredColumns: string[];
  },
): NativeV2PanelManifest => panel;

export const nativeV2DashboardManifests: readonly NativeV2DashboardManifest[] =
  [
    {
      id: "customer-roi-v2",
      name: "Customer ROI v2",
      description:
        "Native value-realization dashboard: KPI, period trend, account detail, and evidence callouts.",
      category: "Acquisition",
      tags: ["native", "v2", "roi", "value-realization", "customer"],
      requiredBindings: ["roi.kpi", "roi.trend", "roi.detail"],
      panels: [
        section("roi-overview", "Value realization", "Overview"),
        boundPanel({
          id: "roi-kpi",
          title: "Realized value",
          bindingKey: "roi.kpi",
          chartType: "metric",
          width: 1,
          tab: "Overview",
          config: {
            yKey: "value",
            yFormatter: "currency",
            description: "The bound program's current realized-value KPI.",
          },
          requiredColumns: ["value"],
        }),
        boundPanel({
          id: "roi-trend",
          title: "Value over time",
          bindingKey: "roi.trend",
          chartType: "line",
          width: 3,
          tab: "Overview",
          config: {
            xKey: "period",
            yKey: "value",
            yFormatter: "currency",
            legend: false,
          },
          requiredColumns: ["period", "value"],
        }),
        boundPanel({
          id: "roi-detail",
          title: "Account-level value evidence",
          bindingKey: "roi.detail",
          chartType: "table",
          width: 3,
          tab: "Accounts",
          config: {
            columns: [
              { key: "account", label: "Account" },
              { key: "period", label: "Period", format: "date" },
              { key: "investment", label: "Investment", format: "currency" },
              { key: "value", label: "Value", format: "currency" },
              { key: "roi", label: "ROI", format: "percent" },
              { key: "matched_by", label: "Matched by" },
              { key: "match_quality", label: "Match quality" },
            ],
            limit: 100,
          },
          requiredColumns: [
            "account",
            "period",
            "investment",
            "value",
            "roi",
            "matched_by",
            "match_quality",
          ],
        }),
      ],
    },
    {
      id: "account-engagement-v2",
      name: "Account Engagement v2",
      description:
        "Native engagement coverage dashboard: headline coverage, daily trend, segment heatmap, and alerts.",
      category: "Product",
      tags: ["native", "v2", "engagement", "adoption", "customer"],
      requiredBindings: [
        "engagement.kpi",
        "engagement.trend",
        "engagement.heatmap",
        "engagement.alerts",
      ],
      panels: [
        section("engagement-overview", "Account engagement", "Overview"),
        boundPanel({
          id: "engagement-kpi",
          title: "Engaged accounts",
          bindingKey: "engagement.kpi",
          chartType: "metric",
          width: 1,
          tab: "Overview",
          config: {
            yKey: "value",
            description: "The bound program's current engaged-account count.",
          },
          requiredColumns: ["value"],
        }),
        boundPanel({
          id: "engagement-trend",
          title: "Engagement over time",
          bindingKey: "engagement.trend",
          chartType: "line",
          width: 3,
          tab: "Overview",
          config: {
            xKey: "period",
            yKey: "value",
            legend: false,
          },
          requiredColumns: ["period", "value"],
        }),
        boundPanel({
          id: "engagement-heatmap",
          title: "Engagement by segment",
          bindingKey: "engagement.heatmap",
          chartType: "heatmap",
          width: 3,
          tab: "Segments",
          config: {
            xKey: "period",
            yKey: "value",
            color: "segment",
            yFormatter: "percent",
          },
          requiredColumns: ["period", "segment", "value"],
        }),
        boundPanel({
          id: "engagement-alerts",
          title: "Engagement alerts",
          bindingKey: "engagement.alerts",
          chartType: "callout",
          width: 3,
          tab: "Alerts",
          requiredColumns: ["severity", "message"],
        }),
      ],
    },
    {
      id: "cross-sell-v2",
      name: "Cross-sell v2",
      description:
        "Native cross-sell dashboard: ordered opportunity funnel, pipeline value, account table, and trend.",
      category: "Acquisition",
      tags: ["native", "v2", "cross-sell", "pipeline", "gtm"],
      requiredBindings: [
        "cross_sell.funnel",
        "cross_sell.kpi",
        "cross_sell.pipeline",
        "cross_sell.trend",
      ],
      panels: [
        section("cross-sell-overview", "Cross-sell pipeline", "Overview"),
        boundPanel({
          id: "cross-sell-funnel",
          title: "Opportunity funnel",
          bindingKey: "cross_sell.funnel",
          chartType: "funnel",
          width: 3,
          tab: "Overview",
          config: {
            xKey: "stage",
            yKey: "value",
            yFormatter: "currency",
          },
          requiredColumns: ["stage", "value"],
        }),
        boundPanel({
          id: "cross-sell-kpi",
          title: "Pipeline value",
          bindingKey: "cross_sell.kpi",
          chartType: "metric",
          width: 1,
          tab: "Overview",
          config: {
            yKey: "value",
            yFormatter: "currency",
          },
          requiredColumns: ["value"],
        }),
        boundPanel({
          id: "cross-sell-pipeline",
          title: "Account pipeline",
          bindingKey: "cross_sell.pipeline",
          chartType: "table",
          width: 3,
          tab: "Accounts",
          config: {
            columns: [
              { key: "account", label: "Account" },
              { key: "stage", label: "Stage" },
              { key: "value", label: "Value", format: "currency" },
              { key: "owner", label: "Owner" },
              { key: "matched_by", label: "Matched by" },
              { key: "match_quality", label: "Match quality" },
            ],
            limit: 100,
          },
          requiredColumns: [
            "account",
            "stage",
            "value",
            "owner",
            "matched_by",
            "match_quality",
          ],
        }),
        boundPanel({
          id: "cross-sell-trend",
          title: "Pipeline over time",
          bindingKey: "cross_sell.trend",
          chartType: "area",
          width: 3,
          tab: "Trend",
          config: {
            xKey: "period",
            yKey: "value",
            yFormatter: "currency",
            legend: false,
          },
          requiredColumns: ["period", "value"],
        }),
      ],
    },
    {
      id: "win-loss-v2",
      name: "Win / Loss v2",
      description:
        "Native outcome dashboard: win/loss totals, reason breakdown, evidence table, and follow-up alerts.",
      category: "Operations",
      tags: ["native", "v2", "win-loss", "sales", "evidence"],
      requiredBindings: [
        "win_loss.summary",
        "win_loss.reasons",
        "win_loss.evidence",
        "win_loss.alerts",
      ],
      panels: [
        section("win-loss-overview", "Win / loss outcomes", "Overview"),
        boundPanel({
          id: "win-loss-summary",
          title: "Outcome totals",
          bindingKey: "win_loss.summary",
          chartType: "bar",
          width: 3,
          tab: "Overview",
          config: {
            xKey: "outcome",
            yKey: "value",
            yFormatter: "currency",
            legend: false,
          },
          requiredColumns: ["outcome", "value"],
        }),
        boundPanel({
          id: "win-loss-reasons",
          title: "Reasons",
          bindingKey: "win_loss.reasons",
          chartType: "bar",
          width: 3,
          tab: "Reasons",
          config: {
            xKey: "reason",
            yKey: "value",
            legend: false,
          },
          requiredColumns: ["reason", "value"],
        }),
        boundPanel({
          id: "win-loss-evidence",
          title: "Outcome evidence",
          bindingKey: "win_loss.evidence",
          chartType: "table",
          width: 3,
          tab: "Evidence",
          config: {
            columns: [
              { key: "account", label: "Account" },
              { key: "outcome", label: "Outcome" },
              { key: "reason", label: "Reason" },
              { key: "value", label: "Value", format: "currency" },
              { key: "evidence", label: "Evidence" },
              { key: "match_quality", label: "Match quality" },
            ],
            limit: 100,
          },
          requiredColumns: [
            "account",
            "outcome",
            "reason",
            "value",
            "evidence",
            "match_quality",
          ],
        }),
        boundPanel({
          id: "win-loss-alerts",
          title: "Follow-up alerts",
          bindingKey: "win_loss.alerts",
          chartType: "callout",
          width: 3,
          tab: "Alerts",
          requiredColumns: ["severity", "message"],
        }),
      ],
    },
  ] as const;

export function getNativeV2DashboardManifest(
  id: NativeV2DashboardId,
): NativeV2DashboardManifest {
  const manifest = nativeV2DashboardManifests.find((entry) => entry.id === id);
  if (!manifest) throw new Error(`Unknown native v2 dashboard: ${id}`);
  return manifest;
}

export function compileNativeV2Dashboard(
  manifest: NativeV2DashboardManifest,
  bindings: Partial<Record<NativeV2BindingKey, NativeV2Binding>>,
  installedAt: string,
): SqlDashboardConfig {
  const missing = manifest.requiredBindings.filter(
    (bindingKey) => !bindings[bindingKey]?.programId.trim(),
  );
  if (missing.length > 0) {
    throw new Error(
      `${manifest.id} is missing required bindings: ${missing.join(", ")}`,
    );
  }

  return {
    name: manifest.name,
    description: manifest.description,
    columns: 6,
    catalog: {
      templateId: manifest.id,
      templateVersion: NATIVE_V2_DASHBOARD_VERSION,
      installedAt,
    },
    panels: manifest.panels.map((panel) => {
      if (!panel.bindingKey) {
        return {
          id: panel.id,
          title: panel.title,
          source: "first-party",
          chartType: panel.chartType,
          width: panel.width,
          ...(panel.columns ? { columns: panel.columns } : {}),
          ...(panel.tab ? { tab: panel.tab } : {}),
          ...(panel.config ? { config: panel.config } : {}),
          sql: "",
        } satisfies SqlPanel;
      }

      const binding = bindings[panel.bindingKey];
      if (!binding) {
        throw new Error(`Missing binding: ${panel.bindingKey}`);
      }
      return {
        id: panel.id,
        title: panel.title,
        source: "program",
        chartType: panel.chartType,
        width: panel.width,
        ...(panel.tab ? { tab: panel.tab } : {}),
        ...(panel.config ? { config: panel.config } : {}),
        sql: JSON.stringify({
          programId: binding.programId,
          ...(binding.params ? { params: binding.params } : {}),
        }),
      } satisfies SqlPanel;
    }),
  };
}
