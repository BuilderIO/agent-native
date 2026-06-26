import { defineAction, embedApp } from "@agent-native/core";
import {
  hasCollabState,
  applyText,
  seedFromText,
} from "@agent-native/core/collab";
import {
  getRequestUserEmail,
  getRequestOrgId,
  buildDeepLink,
} from "@agent-native/core/server";
import { z } from "zod";

import { getDashboard, upsertDashboard } from "../server/lib/dashboards-store";
import { validateFirstPartyAnalyticsSql } from "../server/lib/first-party-analytics.js";
import {
  buildFirstPartyDashboardFilters,
  buildPanel,
  listMetricKeys,
  type ComposedPanel,
  type MetricWindow,
  usesFirstPartyDashboardFilters,
} from "../server/lib/first-party-metric-catalog";

/**
 * Push the saved config through the collab layer so open dashboard editors get
 * the change in real time (mirrors update-dashboard / install-dashboard-template).
 */
async function syncToCollab(
  dashboardId: string,
  config: Record<string, unknown>,
): Promise<void> {
  const docId = `dash-${dashboardId}`;
  const configStr = JSON.stringify(config);
  try {
    if (await hasCollabState(docId)) {
      await applyText(docId, configStr, "content", "agent");
    } else {
      await seedFromText(docId, configStr);
    }
  } catch {
    // Collab sync is best-effort — the SQL write is the source of truth.
  }
}

const WINDOWS = new Set<MetricWindow>(["30d", "90d", "all"]);

function normalizeWindow(raw: unknown): MetricWindow | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim() as MetricWindow;
  return WINDOWS.has(v) ? v : undefined;
}

/** One requested metric, normalized to a key plus optional overrides. */
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
    "If the dashboard already exists and `overwrite` is false (default), the new panels are APPENDED (panels whose id is already present are skipped); with `overwrite: true` the config is replaced. " +
    "Returns { dashboardId, panelCount, createdMetrics, unknownMetrics, invalidMetrics, urlPath, deepLink, message } — use panelCount as proof-of-done. " +
    `Available metric keys: ${METRIC_KEYS.join(", ")}. ` +
    "Each metric accepts an optional per-metric `window` of '30d' | '90d' | 'all' (only affects windowed virality/time metrics).",
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
  run: async (args) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const ctx = { email, orgId: getRequestOrgId() || null };

    // The CLI/gateway may hand `metrics` over as a JSON string; the schema
    // preprocess handles that, but normalize defensively here too.
    const rawMetrics: unknown[] = Array.isArray(args.metrics)
      ? (args.metrics as unknown[])
      : typeof args.metrics === "string"
        ? (JSON.parse(args.metrics) as unknown[])
        : [];

    const requests: NormalizedRequest[] = [];
    for (const raw of rawMetrics) {
      const normalized = normalizeRequest(raw);
      if (normalized) requests.push(normalized);
    }

    const createdMetrics: string[] = [];
    const unknownMetrics: string[] = [];
    const invalidMetrics: Array<{ metric: string; reason: string }> = [];
    const composedPanels: ComposedPanel[] = [];

    for (const req of requests) {
      const panel = buildPanel(req.metric, {
        id: req.id,
        title: req.title,
        chartType: req.chartType,
        width: req.width,
        window: req.window,
      });
      if (!panel) {
        // Unknown key — report, never throw.
        if (!unknownMetrics.includes(req.metric)) {
          unknownMetrics.push(req.metric);
        }
        continue;
      }
      // Per-panel graceful validation: a bad panel is dropped + reported, the
      // rest of the dashboard still builds. (Catalog SQL is known-good, so this
      // is a defensive net, e.g. if a future window/override produces bad SQL.)
      try {
        validateFirstPartyAnalyticsSql(panel.sql);
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

    const existing = await getDashboard(args.dashboardId, ctx);
    const dashboardName =
      args.title?.trim() ||
      (existing && typeof existing.config?.name === "string"
        ? (existing.config.name as string)
        : args.dashboardId);

    let finalConfig: Record<string, unknown>;
    let appendedCount = composedPanels.length;
    let skippedExistingIds: string[] = [];

    if (existing && !args.overwrite) {
      // Append: preserve existing panels + order, add only new panel ids.
      const existingConfig = existing.config as Record<string, unknown>;
      const existingPanels = Array.isArray(existingConfig.panels)
        ? (existingConfig.panels as Array<Record<string, unknown>>)
        : [];
      const existingIds = new Set(
        existingPanels
          .map((p) => (typeof p?.id === "string" ? p.id : null))
          .filter((id): id is string => !!id),
      );
      const toAppend: ComposedPanel[] = [];
      for (const panel of composedPanels) {
        if (existingIds.has(panel.id)) {
          skippedExistingIds.push(panel.id);
          continue;
        }
        toAppend.push(panel);
        existingIds.add(panel.id);
      }
      appendedCount = toAppend.length;
      finalConfig = {
        ...existingConfig,
        name:
          typeof existingConfig.name === "string" && existingConfig.name.trim()
            ? existingConfig.name
            : dashboardName,
        panels: [...existingPanels, ...toAppend],
      };
    } else {
      // Create or overwrite: a fresh config with exactly the composed panels.
      finalConfig = {
        name: dashboardName,
        description:
          "First-party analytics dashboard composed from the metric catalog.",
        panels: composedPanels,
      };
    }

    if (
      composedPanels.some((panel) => usesFirstPartyDashboardFilters(panel.sql))
    ) {
      finalConfig = withFirstPartyDashboardFilters(finalConfig);
    }

    const panelCount = Array.isArray(finalConfig.panels)
      ? (finalConfig.panels as unknown[]).length
      : 0;

    // Single atomic save through the same store path update-dashboard uses.
    await upsertDashboard(args.dashboardId, "sql", finalConfig, ctx);
    await syncToCollab(args.dashboardId, finalConfig);

    const parts: string[] = [];
    if (existing && !args.overwrite) {
      parts.push(`Appended ${appendedCount} panel(s) to "${args.dashboardId}"`);
      if (skippedExistingIds.length > 0) {
        parts.push(`${skippedExistingIds.length} already present`);
      }
    } else {
      parts.push(
        `${existing ? "Replaced" : "Created"} "${args.dashboardId}" with ${createdMetrics.length} panel(s)`,
      );
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
      id: args.dashboardId,
      dashboardId: args.dashboardId,
      name: dashboardName,
      panelCount,
      createdMetrics,
      unknownMetrics,
      invalidMetrics,
      skippedExistingIds,
      urlPath: `/dashboards/${args.dashboardId}`,
      deepLink: buildDeepLink({
        app: "analytics",
        view: "adhoc",
        params: { dashboardId: args.dashboardId },
      }),
      message: parts.join("; ") + ".",
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
