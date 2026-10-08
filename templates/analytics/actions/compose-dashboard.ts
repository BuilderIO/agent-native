import { defineAction, embedApp } from "@agent-native/core";
import type { ActionRunContext } from "@agent-native/core/action";
import {
  getRequestUserEmail,
  getRequestOrgId,
  buildDeepLink,
} from "@agent-native/core/server";
import { track } from "@agent-native/core/tracking";
import { z } from "zod";

import {
  dashboardWriteReceipt,
  requireEditableDashboard,
} from "../server/lib/dashboard-agent-write";
import { queueDashboardCollabSync } from "../server/lib/dashboard-collab-sync";
import {
  annotateSummary,
  isAgentCaller,
  verdictFields,
  verifyPanelWrite,
  type PanelVerification,
  type PanelWriteVerdict,
} from "../server/lib/dashboard-panel-verification";
import { validateFirstPartyDashboardTimeScope } from "../server/lib/dashboard-time-scope";
import {
  getDashboard,
  upsertDashboard,
  upsertDashboardWithRetryOutcome,
} from "../server/lib/dashboards-store";
import { validateFirstPartyAnalyticsSqlForScope } from "../server/lib/first-party-analytics.js";
import {
  buildFirstPartyDashboardFilters,
  buildPanel,
  listMetricKeys,
  type ComposedPanel,
  type MetricWindow,
  usesFirstPartyDashboardFilters,
} from "../server/lib/first-party-metric-catalog";

const WINDOWS = new Set<MetricWindow>(["30d", "90d", "all"]);

function normalizeWindow(raw: unknown): MetricWindow | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim() as MetricWindow;
  return WINDOWS.has(v) ? v : undefined;
}

interface NormalizedRequest {
  metric: string;
  id?: string;
  title?: string;
  chartType?: string;
  width?: number;
  window?: MetricWindow;
}

function normalizeRequest(raw: unknown): NormalizedRequest | null {
  if (typeof raw === "string") {
    const metric = raw.trim();
    return metric ? { metric } : null;
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    const metric = typeof obj.metric === "string" ? obj.metric.trim() : "";
    if (!metric) return null;
    const width =
      typeof obj.width === "number" && Number.isFinite(obj.width)
        ? obj.width
        : undefined;
    return {
      metric,
      id: typeof obj.id === "string" ? obj.id : undefined,
      title: typeof obj.title === "string" ? obj.title : undefined,
      chartType: typeof obj.chartType === "string" ? obj.chartType : undefined,
      width,
      window: normalizeWindow(obj.window),
    };
  }
  return null;
}

const metricSchema = z.union([
  z.string(),
  z.object({
    metric: z.string(),
    id: z.string().optional(),
    title: z.string().optional(),
    chartType: z.string().optional(),
    width: z.number().optional(),
    window: z.string().optional(),
  }),
]);

const METRIC_KEYS = listMetricKeys();

function filterId(filter: unknown): string | null {
  if (!filter || typeof filter !== "object" || Array.isArray(filter)) {
    return null;
  }
  const id = (filter as { id?: unknown }).id;
  return typeof id === "string" && id.trim() ? id : null;
}

function withFirstPartyDashboardFilters(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const filters = Array.isArray(config.filters) ? [...config.filters] : [];
  const existingIds = new Set(
    filters
      .map((filter) => filterId(filter))
      .filter((id): id is string => id !== null),
  );
  for (const filter of buildFirstPartyDashboardFilters()) {
    if (!existingIds.has(filter.id)) {
      filters.push(filter);
      existingIds.add(filter.id);
    }
  }
  return { ...config, filters };
}

export default defineAction({
  description:
    "Build a large first-party analytics dashboard in ONE fast call: name the metrics you want and the SERVER generates the validated SQL + chart config for every panel. " +
    "Do NOT hand-author large `update-dashboard` configs panel-by-panel — producing/streaming a big multi-panel config inside the ~40s run budget fails and thrashes. " +
    "Each metric expands into a complete first-party panel from the shipped, already-validated metric catalog. Unknown metric keys are skipped and reported (not fatal); each panel's SQL is validated independently (valid panels are saved, invalid ones reported), and the dashboard is assembled and saved in a single atomic store write. " +
    "If the dashboard already exists and `overwrite` is false (default), the new panels are APPENDED (panels whose id is already present are skipped). Set `refreshExisting: true` to atomically replace matching catalog panels in place while preserving unrelated panels. With `overwrite: true` the config is replaced. " +
    "Returns { dashboardId, panelCount, createdMetrics, refreshedExistingIds, unknownMetrics, invalidMetrics, verified, urlPath, deepLink, message } — use panelCount as proof-of-done, and `verified:true` as proof the panels render. Agent calls run the composed panels the way the dashboard page does before saving and refuse a panel that would show 'No data' or drop its columns; on `verified:false` call `inspect-dashboard-panel`. " +
    `Available metric keys: ${METRIC_KEYS.join(", ")}. ` +
    "Each metric accepts an optional per-metric `window` of '30d' | '90d' | 'all' (only affects windowed virality/time metrics). Catalog panels are time-scoped by construction; custom first-party SQL added later must use `{{timeRange}}` or declare `config.timeScope`.",
  schema: z.object({
    dashboardId: z
      .string()
      .describe(
        "Dashboard id (without the `sql-dashboard-` prefix), e.g. 'first-party-overview'.",
      ),
    title: z
      .string()
      .optional()
      .describe(
        "Dashboard name. Used on create; on append it is applied only if the existing dashboard has no name.",
      ),
    metrics: z
      .preprocess(
        (v) => (typeof v === "string" ? JSON.parse(v) : v),
        z.array(metricSchema),
      )
      .describe(
        "Metric keys to include, in order. Each item is either a key string or { metric, title?, chartType?, width?, window? }. " +
          `Valid keys: ${METRIC_KEYS.join(", ")}.`,
      ),
    overwrite: z
      .boolean()
      .optional()
      .describe(
        "If true, replace the whole dashboard config. If false (default) and the dashboard exists, APPEND the new panels (skipping ids already present).",
      ),
    refreshExisting: z
      .boolean()
      .optional()
      .describe(
        "When appending to an existing dashboard, replace panels whose ids match the requested catalog metrics in place, preserving unrelated panels and layout order. Use this to refresh a catalog-backed dashboard without sending SQL through the prompt.",
      ),
    allowEmptyResult: z
      .boolean()
      .optional()
      .describe(
        "Agent calls only. Set true only when the user expects a composed panel to have no rows right now (for example a brand-new workspace); the save then reports verified:false.",
      ),
  }),
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Dashboard preview",
      description: "Open the composed dashboard in the real Analytics UI.",
      iframeTitle: "Agent-Native Analytics",
      openLabel: "Open dashboard",
      height: 680,
    }),
  },
  run: async (args, actionContext?: ActionRunContext) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const ctx = { email, orgId: getRequestOrgId() || null };
    const agentCaller = isAgentCaller(actionContext?.caller);
    const verificationMemo = new Map<string, PanelVerification>();
    let verdict: PanelWriteVerdict | null = null;

    const rawMetrics: unknown[] = Array.isArray(args.metrics)
      ? (args.metrics as unknown[])
      : typeof args.metrics === "string"
        ? (JSON.parse(args.metrics) as unknown[])
        : [];

    // Composing into an existing dashboard needs edit rights before any SQL
    // is validated or run for it.
    const existing = await getDashboard(args.dashboardId, ctx);
    if (existing)
      await requireEditableDashboard(args.dashboardId, ctx, existing);

    const requests: NormalizedRequest[] = [];
    for (const raw of rawMetrics) {
      const normalized = normalizeRequest(raw);
      if (normalized) requests.push(normalized);
    }

    const createdMetrics: string[] = [];
    const unknownMetrics: string[] = [];
    const invalidMetrics: Array<{ metric: string; reason: string }> = [];
    const composedPanels: ComposedPanel[] = [];
    const catalogDashboard = withFirstPartyDashboardFilters({ filters: [] });

    for (const req of requests) {
      const panel = buildPanel(req.metric, {
        id: req.id,
        title: req.title,
        chartType: req.chartType,
        width: req.width,
        window: req.window,
      });
      if (!panel) {
        if (!unknownMetrics.includes(req.metric)) {
          unknownMetrics.push(req.metric);
        }
        continue;
      }
      try {
        const timeScopeError = validateFirstPartyDashboardTimeScope(
          panel,
          catalogDashboard,
          0,
        );
        if (timeScopeError) {
          invalidMetrics.push({ metric: req.metric, reason: timeScopeError });
          continue;
        }
        await validateFirstPartyAnalyticsSqlForScope(panel.sql, {
          userEmail: ctx.email,
          orgId: ctx.orgId,
        });
      } catch (e: any) {
        invalidMetrics.push({
          metric: req.metric,
          reason: e?.message ?? String(e),
        });
        continue;
      }
      composedPanels.push(panel);
      createdMetrics.push(req.metric);
    }

    const dashboardName =
      args.title?.trim() ||
      (existing && typeof existing.config?.name === "string"
        ? (existing.config.name as string)
        : args.dashboardId);

    function withFilters(
      config: Record<string, unknown>,
    ): Record<string, unknown> {
      return composedPanels.some((panel) =>
        usesFirstPartyDashboardFilters(panel.sql),
      )
        ? withFirstPartyDashboardFilters(config)
        : config;
    }

    let finalConfig!: Record<string, unknown>;
    let updatedAt!: string;
    let appendedCount = composedPanels.length;
    let skippedExistingIds: string[] = [];
    let refreshedExistingIds: string[] = [];
    // Whether the store persisted anything; the counters miss filter-only and
    // identical-config saves.
    let changed = true;
    let appended = existing !== null && !args.overwrite;

    const appendToExisting = async () => {
      appended = true;
      const saved = await upsertDashboardWithRetryOutcome(
        args.dashboardId,
        ctx,
        async (freshExisting) => {
          const existingConfig = freshExisting.config as Record<
            string,
            unknown
          >;
          const existingPanels = Array.isArray(existingConfig.panels)
            ? (existingConfig.panels as Array<Record<string, unknown>>)
            : [];
          const existingIds = new Set(
            existingPanels
              .map((p) => (typeof p?.id === "string" ? p.id : null))
              .filter((id): id is string => !!id),
          );
          const composedById = new Map(
            composedPanels.map((panel) => [panel.id, panel]),
          );
          const refreshed = new Set<string>();
          const mergedExistingPanels = existingPanels.map((panel) => {
            const id = typeof panel?.id === "string" ? panel.id : "";
            const replacement = args.refreshExisting
              ? composedById.get(id)
              : undefined;
            if (!replacement) return panel;
            refreshed.add(id);
            return replacement;
          });
          const toAppend: ComposedPanel[] = [];
          const skipped: string[] = [];
          const appendedIds = new Set<string>();
          for (const panel of composedPanels) {
            if (refreshed.has(panel.id)) continue;
            if (existingIds.has(panel.id)) {
              skipped.push(panel.id);
              continue;
            }
            if (appendedIds.has(panel.id)) continue;
            toAppend.push(panel);
            appendedIds.add(panel.id);
            existingIds.add(panel.id);
          }
          appendedCount = toAppend.length;
          skippedExistingIds = Array.from(new Set(skipped));
          refreshedExistingIds = Array.from(refreshed);
          const merged = withFilters({
            ...existingConfig,
            name:
              typeof existingConfig.name === "string" &&
              existingConfig.name.trim()
                ? existingConfig.name
                : dashboardName,
            panels: [...mergedExistingPanels, ...toAppend],
          });
          if (agentCaller) {
            verdict = await verifyPanelWrite({
              base: existingConfig,
              next: merged,
              signal: actionContext?.signal,
              allowEmptyResult: args.allowEmptyResult,
              memo: verificationMemo,
              dashboardId: args.dashboardId,
              serverAuthoredPanelIds: new Set([...refreshed, ...appendedIds]),
            });
          }
          return { kind: "sql" as const, body: merged };
        },
      );
      finalConfig = saved.dashboard.config as Record<string, unknown>;
      updatedAt = saved.dashboard.updatedAt;
      changed = saved.didWrite;
    };

    if (existing && !args.overwrite) {
      await appendToExisting();
    } else {
      finalConfig = withFilters({
        name: dashboardName,
        description:
          "First-party analytics dashboard composed from the metric catalog.",
        panels: composedPanels,
      });
      if (agentCaller) {
        verdict = await verifyPanelWrite({
          base: existing ? (existing.config as Record<string, unknown>) : null,
          next: finalConfig,
          signal: actionContext?.signal,
          allowEmptyResult: args.allowEmptyResult,
          memo: verificationMemo,
          dashboardId: args.dashboardId,
          serverAuthoredPanelIds: new Set(composedPanels.map(({ id }) => id)),
        });
      }
      // Validation and verification take seconds, so another call may have
      // created this dashboard since `existing` was read.
      const latest = await getDashboard(args.dashboardId, ctx);
      if (latest) await requireEditableDashboard(args.dashboardId, ctx, latest);
      if (latest && !args.overwrite) {
        await appendToExisting();
      } else if (latest) {
        const composed = finalConfig;
        const saved = await upsertDashboardWithRetryOutcome(
          args.dashboardId,
          ctx,
          () => ({ kind: "sql" as const, body: composed }),
        );
        finalConfig = saved.dashboard.config as Record<string, unknown>;
        updatedAt = saved.dashboard.updatedAt;
        changed = saved.didWrite;
      } else {
        const saved = await upsertDashboard(
          args.dashboardId,
          "sql",
          finalConfig,
          ctx,
        );
        updatedAt = saved.updatedAt;
      }
    }

    const panelCount = Array.isArray(finalConfig.panels)
      ? (finalConfig.panels as unknown[]).length
      : 0;

    if (changed) {
      void queueDashboardCollabSync(
        args.dashboardId,
        updatedAt,
        () => getDashboard(args.dashboardId, ctx),
        "agent",
      );
      track(
        "dashboard_saved",
        {
          app_name: "analytics",
          template_name: "analytics",
          output_id: args.dashboardId,
          output_type: "dashboard",
          dashboard_id: args.dashboardId,
          panel_count: panelCount,
          created_panel_count: createdMetrics.length,
          refreshed_panel_count: refreshedExistingIds.length,
        },
        actionContext,
      );
    }

    const parts: string[] = [];
    if (!changed) {
      parts.push(`No changes were needed for "${args.dashboardId}"`);
    } else if (appended) {
      if (refreshedExistingIds.length > 0) {
        parts.push(
          `Refreshed ${refreshedExistingIds.length} existing panel(s)`,
        );
      }
      parts.push(`Appended ${appendedCount} panel(s) to "${args.dashboardId}"`);
    } else {
      parts.push(
        `${existing ? "Replaced" : "Created"} "${args.dashboardId}" with ${createdMetrics.length} panel(s)`,
      );
    }
    if (appended && skippedExistingIds.length > 0) {
      parts.push(`${skippedExistingIds.length} already present`);
    }
    if (unknownMetrics.length > 0) {
      parts.push(
        `skipped ${unknownMetrics.length} unknown metric(s): ${unknownMetrics.join(", ")}`,
      );
    }
    if (invalidMetrics.length > 0) {
      parts.push(
        `skipped ${invalidMetrics.length} invalid metric(s): ${invalidMetrics.map((m) => m.metric).join(", ")}`,
      );
    }
    parts.push(`Dashboard now has ${panelCount} panel(s).`);

    return {
      saved: true,
      changed,
      id: args.dashboardId,
      dashboardId: args.dashboardId,
      name: dashboardName,
      panelCount,
      createdMetrics,
      refreshedExistingIds,
      unknownMetrics,
      invalidMetrics,
      skippedExistingIds,
      ...verdictFields(verdict),
      ...(agentCaller && changed
        ? {
            _receipt: dashboardWriteReceipt(
              args.dashboardId,
              `Saved "${args.dashboardId}" with ${panelCount} panel(s)`,
              verdict,
            ),
          }
        : {}),
      urlPath: `/dashboards/${args.dashboardId}`,
      deepLink: buildDeepLink({
        app: "analytics",
        view: "adhoc",
        params: { dashboardId: args.dashboardId },
      }),
      message: annotateSummary(parts.join("; ") + ".", verdict),
    };
  },
  link: ({ result }) => {
    const dashboardId =
      result && typeof result === "object"
        ? (result as { dashboardId?: string }).dashboardId
        : undefined;
    if (!dashboardId) return null;
    return {
      url: buildDeepLink({
        app: "analytics",
        view: "adhoc",
        params: { dashboardId },
      }),
      label: "Open composed dashboard in Analytics",
      view: "adhoc",
    };
  },
});
