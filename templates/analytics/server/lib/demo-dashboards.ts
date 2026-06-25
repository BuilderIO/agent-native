import { createHash } from "node:crypto";

import {
  applyText,
  hasCollabState,
  seedFromText,
} from "@agent-native/core/collab";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";

import { loadDashboardSeed } from "./dashboard-seeds";
import { getDashboard, upsertDashboard } from "./dashboards-store";

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

export function demoDashboardIdForUser(
  email: string,
  demoId: DemoDashboardId,
): string {
  const hash = createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex")
    .slice(0, 8);
  return `${demoId}-${hash}`;
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
      installedAt: nowIso(),
    },
    catalog: {
      templateId: demoId,
      templateVersion: DEMO_DASHBOARD_VERSION,
      installedAt: nowIso(),
    },
  };
}

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
    // SQL is the source of truth; collab can seed lazily later.
  }
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
  const privateCtx = { email: ctx.email, orgId: null };
  const state = await readDemoState(ctx.email);
  const deleted = reset ? {} : { ...(state.deleted ?? {}) };
  const dashboards = { ...(state.dashboards ?? {}) };
  const results: EnsuredDemoDashboard[] = [];

  for (const demo of DEMO_DASHBOARDS) {
    const dashboardId =
      dashboards[demo.id]?.dashboardId ??
      demoDashboardIdForUser(ctx.email, demo.id);
    const deletedAt = deleted[demo.id];

    if (deletedAt && !reset) {
      results.push({
        id: demo.id,
        dashboardId,
        name: demo.name,
        path: demoDashboardPath(dashboardId),
        installed: false,
        created: false,
        archivedAt: null,
        deleted: true,
      });
      dashboards[demo.id] = {
        dashboardId,
        seedId: demo.seedId,
        installedAt: dashboards[demo.id]?.installedAt,
        deletedAt,
      };
      continue;
    }

    const existing = await getDashboard(dashboardId, privateCtx);
    const existingVersion =
      existing?.config?.demo &&
      typeof existing.config.demo === "object" &&
      !Array.isArray(existing.config.demo)
        ? (existing.config.demo as Record<string, unknown>).version
        : undefined;
    const isOutdated = existingVersion !== DEMO_DASHBOARD_VERSION;
    let archivedAt = existing?.archivedAt ?? null;
    let created = false;
    if (!existing || reset || isOutdated) {
      const seed = loadDashboardSeed(demo.seedId);
      if (!seed)
        throw new Error(`Demo dashboard seed not found: ${demo.seedId}`);
      const config = applyDemoMetadata(seed, demo.id);
      const row = await upsertDashboard(dashboardId, "sql", config, privateCtx);
      await syncToCollab(dashboardId, config);
      archivedAt = row.archivedAt;
      created = !existing;
    }

    dashboards[demo.id] = {
      dashboardId,
      seedId: demo.seedId,
      installedAt: dashboards[demo.id]?.installedAt ?? nowIso(),
      deletedAt: null,
    };
    results.push({
      id: demo.id,
      dashboardId,
      name: demo.name,
      path: demoDashboardPath(dashboardId),
      installed: true,
      created,
      archivedAt,
      deleted: false,
    });
  }

  const updatedState: DemoDashboardState = {
    version: DEMO_DASHBOARD_VERSION,
    initializedAt: state.initializedAt ?? nowIso(),
    updatedAt: nowIso(),
    dashboards,
    deleted,
  };
  await writeDemoState(ctx.email, updatedState);

  const firstActive = results.find((row) => row.installed && !row.archivedAt);
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
  let demoId = Object.entries(dashboards).find(
    ([, row]) => row.dashboardId === dashboardId,
  )?.[0] as DemoDashboardId | undefined;

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
