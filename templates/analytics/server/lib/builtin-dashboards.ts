import { createHash } from "node:crypto";

import {
  getOrgSetting,
  getUserSetting,
  mutateOrgSetting,
  mutateUserSetting,
} from "@agent-native/core/settings";

import {
  BUILTIN_DEMO_DASHBOARD_ID,
  BUILTIN_RISK_MEETING_DASHBOARD_ID,
  NATIVE_V2_TEMPLATE_IDS,
  SEED_BUILTIN_DASHBOARD_IDS,
  nativeV2BuiltinDashboardId,
} from "../../shared/builtin-dashboard-ids";
import { normalizeDashboardConfig } from "../../shared/dashboard-config-normalization";
import { repairKnownFirstPartyDashboardQueries } from "./canonical-first-party-dashboard-repair";
import { loadDashboardSeed } from "./dashboard-seeds";
import {
  demoNodeExporterConfig,
  isDemoDashboardDeleted,
} from "./demo-dashboards";
import {
  compileNativeV2Dashboard,
  getNativeV2DashboardManifest,
  type NativeV2Binding,
  type NativeV2DashboardId,
} from "./native-v2-dashboards";

export const BUILTIN_DASHBOARD_INSTALLS_KEY = "analytics-builtin-dashboards";

export const RISK_MEETING_COHORT_PROGRAM = "risk-meeting-cohort";
export const RISK_MEETING_EARLY_WARNING_PROGRAM =
  "risk-meeting-pylon-early-warning";

interface Scope {
  email: string;
  orgId: string | null;
}

/** What an org (or a user with no org) installed; the dashboard itself is code. */
export interface BuiltinDashboardInstall {
  installedAt: string;
  installedBy: string;
  bindings?: Record<string, NativeV2Binding>;
  programIds?: Record<string, string>;
}

export interface BuiltinDashboard {
  id: string;
  /** Changes whenever the shipped definition does. */
  version: string;
  title: string;
  config: Record<string, unknown>;
}

function nativeTemplateId(builtinId: string): NativeV2DashboardId | null {
  return (
    NATIVE_V2_TEMPLATE_IDS.find(
      (templateId) => nativeV2BuiltinDashboardId(templateId) === builtinId,
    ) ?? null
  );
}

function programPanel(id: string, title: string, programId: string) {
  return {
    id,
    title,
    source: "program",
    chartType: "table",
    width: 2,
    sql: JSON.stringify({ programId }),
  };
}

export function riskMeetingDashboardConfig(
  programIds: Record<string, string>,
): Record<string, unknown> {
  return {
    name: "Risk Meeting",
    description:
      "HubSpot deal-property risk cohort joined with Pylon account sentiment, " +
      "plus Pylon-only early-warning accounts not yet in the HubSpot cohort. " +
      "Both panels are bound to stored data programs — see the data-programs " +
      "skill for how the underlying join works.",
    panels: [
      programPanel(
        "risk-meeting-cohort-panel",
        "Risk Meeting Cohort (HubSpot x Pylon)",
        programIds[RISK_MEETING_COHORT_PROGRAM],
      ),
      programPanel(
        "risk-meeting-early-warning-panel",
        "Pylon Early Warning (not yet in HubSpot cohort)",
        programIds[RISK_MEETING_EARLY_WARNING_PROGRAM],
      ),
    ],
  };
}

/** Built-ins built from what their install recorded. */
function builtFromInstall(builtinId: string): boolean {
  return (
    builtinId === BUILTIN_RISK_MEETING_DASHBOARD_ID ||
    nativeTemplateId(builtinId) !== null
  );
}

/** Built-ins the dashboards list shows only once somebody installed them. */
function listedWhenInstalled(builtinId: string): boolean {
  return (
    builtFromInstall(builtinId) ||
    (SEED_BUILTIN_DASHBOARD_IDS as readonly string[]).includes(builtinId)
  );
}

/**
 * The shipped config for a built-in, or null when it needs inputs the install
 * doesn't have. Pure, so the deploy pass compares rows against exactly what a
 * reader would be served.
 */
export function buildBuiltinDashboard(
  builtinId: string,
  install?: BuiltinDashboardInstall | null,
): BuiltinDashboard | null {
  let config: Record<string, unknown> | null = null;
  if (builtinId === BUILTIN_DEMO_DASHBOARD_ID) {
    config = demoNodeExporterConfig();
  } else if (builtinId === BUILTIN_RISK_MEETING_DASHBOARD_ID) {
    const programIds = install?.programIds;
    if (
      programIds?.[RISK_MEETING_COHORT_PROGRAM] &&
      programIds[RISK_MEETING_EARLY_WARNING_PROGRAM]
    ) {
      config = riskMeetingDashboardConfig(programIds);
    }
  } else if (nativeTemplateId(builtinId)) {
    const manifest = getNativeV2DashboardManifest(nativeTemplateId(builtinId)!);
    const bindings = install?.bindings ?? {};
    if (manifest.requiredBindings.every((key) => bindings[key]?.programId)) {
      config = compileNativeV2Dashboard(
        manifest,
        bindings,
        install!.installedAt,
      ) as unknown as Record<string, unknown>;
    }
  } else if (
    (SEED_BUILTIN_DASHBOARD_IDS as readonly string[]).includes(builtinId)
  ) {
    const seed = loadDashboardSeed(builtinId);
    if (seed) {
      config = repairKnownFirstPartyDashboardQueries(builtinId, seed).config;
    }
  }
  if (!config) return null;
  const normalized = normalizeDashboardConfig(config);
  return {
    id: builtinId,
    version: createHash("sha256")
      .update(JSON.stringify(withoutInstallTimes(normalized)))
      .digest("hex")
      .slice(0, 12),
    title: typeof normalized.name === "string" ? normalized.name : builtinId,
    config: normalized,
  };
}

/**
 * Install stamps differ per copy and say nothing about content, so they are
 * left out wherever a copy is compared with what shipped.
 */
export function withoutInstallTimes(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...config };
  for (const key of ["catalog", "demo"] as const) {
    const value = out[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const { installedAt: _installedAt, ...rest } = value as Record<
        string,
        unknown
      >;
      out[key] = rest;
    }
  }
  return out;
}

/**
 * Risk Meeting runs data programs its installer owns, so it is installed for
 * that person; the rest are installed for the whole org.
 */
function installedPersonally(builtinId: string): boolean {
  return builtinId === BUILTIN_RISK_MEETING_DASHBOARD_ID;
}

async function readInstalls(
  scope: Scope,
): Promise<Record<string, BuiltinDashboardInstall>> {
  const [personal, org] = await Promise.all([
    getUserSetting(scope.email, BUILTIN_DASHBOARD_INSTALLS_KEY),
    scope.orgId
      ? getOrgSetting(scope.orgId, BUILTIN_DASHBOARD_INSTALLS_KEY)
      : null,
  ]);
  const installs: Record<string, BuiltinDashboardInstall> = {};
  for (const [id, install] of Object.entries(personal ?? {})) {
    if (installedPersonally(id) || id === "google-analytics" || !scope.orgId) {
      installs[id] = install as BuiltinDashboardInstall;
    }
  }
  for (const [id, install] of Object.entries(org ?? {})) {
    if (!installedPersonally(id)) {
      installs[id] = install as BuiltinDashboardInstall;
    }
  }
  return installs;
}

export async function recordBuiltinDashboardInstall(
  scope: Scope,
  builtinId: string,
  install: Omit<BuiltinDashboardInstall, "installedAt" | "installedBy"> & {
    installedAt?: string;
  },
): Promise<void> {
  const update = (current: Record<string, unknown> | null) => ({
    ...(current ?? {}),
    [builtinId]: {
      installedAt: install.installedAt ?? new Date().toISOString(),
      installedBy: scope.email,
      ...(install.bindings ? { bindings: install.bindings } : {}),
      ...(install.programIds ? { programIds: install.programIds } : {}),
    } satisfies BuiltinDashboardInstall,
  });
  if (scope.orgId && !installedPersonally(builtinId)) {
    await mutateOrgSetting(scope.orgId, BUILTIN_DASHBOARD_INSTALLS_KEY, update);
  } else {
    await mutateUserSetting(
      scope.email,
      BUILTIN_DASHBOARD_INSTALLS_KEY,
      update,
    );
  }
}

/** The built-in a reader in `scope` sees at `builtinId`, or null if none. */
export async function loadBuiltinDashboard(
  builtinId: string,
  scope: Scope,
): Promise<BuiltinDashboard | null> {
  if (
    builtinId === BUILTIN_DEMO_DASHBOARD_ID &&
    (await isDemoDashboardDeleted(scope.email))
  ) {
    return null;
  }
  if (!builtFromInstall(builtinId)) return buildBuiltinDashboard(builtinId);
  const install = (await readInstalls(scope))[builtinId];
  return install ? buildBuiltinDashboard(builtinId, install) : null;
}

/** Records an install that takes no inputs, keeping the first install time. */
export async function installBuiltinDashboardOnce(
  scope: Scope,
  builtinId: string,
): Promise<void> {
  const installs =
    scope.orgId && !installedPersonally(builtinId)
      ? await getOrgSetting(scope.orgId, BUILTIN_DASHBOARD_INSTALLS_KEY)
      : await getUserSetting(scope.email, BUILTIN_DASHBOARD_INSTALLS_KEY);
  if (installs?.[builtinId]) return;
  await recordBuiltinDashboardInstall(scope, builtinId, {});
}

/** The built-ins the dashboards list shows a reader in `scope`. */
export async function listBuiltinDashboards(
  scope: Scope,
): Promise<BuiltinDashboard[]> {
  const installs = await readInstalls(scope);
  const listed: BuiltinDashboard[] = [];
  if (!(await isDemoDashboardDeleted(scope.email))) {
    const demo = buildBuiltinDashboard(BUILTIN_DEMO_DASHBOARD_ID);
    if (demo) listed.push(demo);
  }
  for (const [builtinId, install] of Object.entries(installs)) {
    if (!listedWhenInstalled(builtinId)) continue;
    const dashboard = buildBuiltinDashboard(builtinId, install);
    if (dashboard) listed.push(dashboard);
  }
  return listed;
}
