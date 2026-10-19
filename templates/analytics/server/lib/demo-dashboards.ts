import { getUserSetting, putUserSetting } from "@agent-native/core/settings";

import { BUILTIN_DEMO_DASHBOARD_ID } from "../../shared/builtin-dashboard-ids";
import { loadDashboardSeed } from "./dashboard-seeds";
import { getDashboard } from "./dashboards-store";

export const DEMO_DASHBOARD_VERSION = "2026-06-11-app-tabs-lite-overview";
export const DEMO_DASHBOARD_STATE_KEY = "analytics-demo-dashboards";
export const DEMO_NODE_EXPORTER_INSTANCE = "127.0.0.1:9100";
export const DEMO_NODE_EXPORTER_JOB = "node";
export const DEMO_NODE_EXPORTER_DEFAULT_TAB = "App / Overview";

export const DEMO_DASHBOARDS = [
  {
    id: "demo-node-exporter",
    seedId: "node-exporter-full",
    name: "Demo Node Exporter Full",
  },
] as const;

export type DemoDashboardId = (typeof DEMO_DASHBOARDS)[number]["id"];

interface AccessCtx {
  email: string;
  orgId: string | null;
}

interface DemoDashboardState {
  version?: string;
  initializedAt?: string;
  updatedAt?: string;
  dashboards?: Record<
    string,
    {
      dashboardId: string;
      seedId: string;
      installedAt?: string;
      deletedAt?: string | null;
    }
  >;
  deleted?: Record<string, string>;
}

export interface EnsuredDemoDashboard {
  id: DemoDashboardId;
  dashboardId: string;
  name: string;
  path: string;
  installed: boolean;
  created: boolean;
  archivedAt: string | null;
  deleted: boolean;
}

function demoDashboardPath(dashboardId: string): string {
  const params = new URLSearchParams({
    tab: DEMO_NODE_EXPORTER_DEFAULT_TAB,
  });
  return `/dashboards/${dashboardId}?${params.toString()}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeState(
  value: Record<string, unknown> | null,
): DemoDashboardState {
  if (!value || typeof value !== "object") return {};
  return {
    version: typeof value.version === "string" ? value.version : undefined,
    initializedAt:
      typeof value.initializedAt === "string" ? value.initializedAt : undefined,
    updatedAt:
      typeof value.updatedAt === "string" ? value.updatedAt : undefined,
    dashboards:
      value.dashboards &&
      typeof value.dashboards === "object" &&
      !Array.isArray(value.dashboards)
        ? (value.dashboards as DemoDashboardState["dashboards"])
        : {},
    deleted:
      value.deleted &&
      typeof value.deleted === "object" &&
      !Array.isArray(value.deleted)
        ? (value.deleted as Record<string, string>)
        : {},
  };
}

function publicState(state: DemoDashboardState): Record<string, unknown> {
  return {
    version: state.version,
    initializedAt: state.initializedAt,
    updatedAt: state.updatedAt,
    dashboards: state.dashboards ?? {},
    deleted: state.deleted ?? {},
  };
}

function stateContent(state: DemoDashboardState): string {
  return JSON.stringify({
    version: state.version,
    initializedAt: state.initializedAt,
    dashboards: state.dashboards ?? {},
    deleted: state.deleted ?? {},
  });
}

function demoIdFromConfig(
  config: Record<string, unknown>,
): DemoDashboardId | null {
  const demo = config.demo;
  if (!demo || typeof demo !== "object" || Array.isArray(demo)) return null;
  const id = (demo as Record<string, unknown>).id;
  return DEMO_DASHBOARDS.some((d) => d.id === id)
    ? (id as DemoDashboardId)
    : null;
}

/** The demo as shipped; legacy per-user copies also carried install times. */
export function demoNodeExporterConfig(): Record<string, unknown> {
  const demo = DEMO_DASHBOARDS[0];
  const seed = loadDashboardSeed(demo.seedId);
  if (!seed) throw new Error(`Demo dashboard seed not found: ${demo.seedId}`);
  return applyDemoMetadata(seed, demo.id);
}

function applyDemoMetadata(
  seed: Record<string, unknown>,
  demoId: DemoDashboardId,
): Record<string, unknown> {
  const filters = Array.isArray(seed.filters)
    ? seed.filters.map((filter) => {
        if (!filter || typeof filter !== "object" || Array.isArray(filter)) {
          return filter;
        }
        const id = (filter as Record<string, unknown>).id;
        if (id === "instance") {
          return { ...filter, default: DEMO_NODE_EXPORTER_INSTANCE };
        }
        if (id === "job") {
          return { ...filter, default: DEMO_NODE_EXPORTER_JOB };
        }
        return filter;
      })
    : seed.filters;
  const panels = Array.isArray(seed.panels)
    ? seed.panels.map((panel) => {
        if (
          panel &&
          typeof panel === "object" &&
          !Array.isArray(panel) &&
          (panel as Record<string, unknown>).source === "prometheus"
        ) {
          return { ...panel, source: "demo" };
        }
        return panel;
      })
    : seed.panels;
  return {
    ...seed,
    name: "Demo Node Exporter Full",
    description:
      "The full Node Exporter dashboard wired to the built-in demo Prometheus endpoint.",
    filters,
    panels,
    demo: {
      id: demoId,
      version: DEMO_DASHBOARD_VERSION,
    },
    catalog: {
      templateId: demoId,
      templateVersion: DEMO_DASHBOARD_VERSION,
    },
  };
}

async function readDemoState(email: string): Promise<DemoDashboardState> {
  return normalizeState(await getUserSetting(email, DEMO_DASHBOARD_STATE_KEY));
}

async function writeDemoState(
  email: string,
  state: DemoDashboardState,
): Promise<void> {
  await putUserSetting(email, DEMO_DASHBOARD_STATE_KEY, publicState(state));
}

export async function isDemoDashboardDeleted(email: string): Promise<boolean> {
  const state = await readDemoState(email);
  return DEMO_DASHBOARDS.every((demo) => Boolean(state.deleted?.[demo.id]));
}

/**
 * The demo is a built-in served from code, so installing it only records
 * whether this user deleted it. `reset` brings a deleted demo back.
 */
export async function ensureDemoDashboardsForUser(
  ctx: AccessCtx,
  options: { reset?: boolean } = {},
): Promise<{
  dashboards: EnsuredDemoDashboard[];
  defaultDashboardId: string | null;
  defaultDashboardPath: string | null;
  reset: boolean;
}> {
  if (!ctx.email) throw new Error("no authenticated user");
  const reset = options.reset === true;
  const state = await readDemoState(ctx.email);
  const deleted = reset ? {} : { ...(state.deleted ?? {}) };
  const results: EnsuredDemoDashboard[] = DEMO_DASHBOARDS.map((demo) => ({
    id: demo.id,
    dashboardId: BUILTIN_DEMO_DASHBOARD_ID,
    name: demo.name,
    path: demoDashboardPath(BUILTIN_DEMO_DASHBOARD_ID),
    installed: !deleted[demo.id],
    created: false,
    archivedAt: null,
    deleted: Boolean(deleted[demo.id]),
  }));

  const updatedStateContent: DemoDashboardState = {
    version: DEMO_DASHBOARD_VERSION,
    initializedAt: state.initializedAt ?? nowIso(),
    dashboards: state.dashboards ?? {},
    deleted,
  };
  if (reset || stateContent(state) !== stateContent(updatedStateContent)) {
    await writeDemoState(ctx.email, {
      ...updatedStateContent,
      updatedAt: nowIso(),
    });
  }

  const firstActive = results.find((row) => row.installed);
  return {
    dashboards: results,
    defaultDashboardId: firstActive?.dashboardId ?? null,
    defaultDashboardPath: firstActive?.path ?? null,
    reset,
  };
}

export async function markDemoDashboardDeleted(
  dashboardId: string,
  ctx: AccessCtx,
): Promise<void> {
  if (!ctx.email) return;
  const state = await readDemoState(ctx.email);
  const dashboards = { ...(state.dashboards ?? {}) };
  let demoId = (
    dashboardId === BUILTIN_DEMO_DASHBOARD_ID
      ? DEMO_DASHBOARDS[0].id
      : Object.entries(dashboards).find(
          ([, row]) => row.dashboardId === dashboardId,
        )?.[0]
  ) as DemoDashboardId | undefined;

  if (!demoId) {
    const dashboard = await getDashboard(dashboardId, ctx).catch(() => null);
    demoId = dashboard
      ? (demoIdFromConfig(dashboard.config) ?? undefined)
      : undefined;
  }
  if (!demoId) return;

  const deletedAt = nowIso();
  dashboards[demoId] = {
    dashboardId,
    seedId: dashboards[demoId]?.seedId ?? demoId,
    installedAt: dashboards[demoId]?.installedAt,
    deletedAt,
  };
  await writeDemoState(ctx.email, {
    ...state,
    version: DEMO_DASHBOARD_VERSION,
    updatedAt: deletedAt,
    dashboards,
    deleted: {
      ...(state.deleted ?? {}),
      [demoId]: deletedAt,
    },
  });
}
