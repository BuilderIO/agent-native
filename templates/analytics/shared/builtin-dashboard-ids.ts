/**
 * Built-in dashboards are served from code, read-only, and change when the
 * app ships. Customizing one means duplicating it into an ordinary dashboard.
 *
 * Before this, each built-in was written as a per-user or per-org row the
 * first time it was installed. Those rows keep their ids: one that still
 * matches what shipped is hidden by the deploy pass (`hidden_by` below) and its
 * id forwards to the built-in; one somebody changed stays an ordinary row.
 */
export const BUILTIN_DASHBOARD_HIDDEN_BY = "analytics:builtin-dashboards";

export const BUILTIN_DEMO_DASHBOARD_ID = "builtin-demo-node-exporter";
export const BUILTIN_RISK_MEETING_DASHBOARD_ID = "builtin-risk-meeting";

export const NATIVE_V2_TEMPLATE_IDS = [
  "customer-roi-v2",
  "account-engagement-v2",
  "cross-sell-v2",
  "win-loss-v2",
  "on-demand-billing-v2",
] as const;

/**
 * Built-ins that keep the seed id they were always served at. A row at one
 * of these ids is somebody's saved copy and wins, unless the deploy pass hid
 * it as an untouched copy.
 */
export const SEED_BUILTIN_DASHBOARD_IDS = [
  "agent-native-templates-first-party",
  "skills-cli-funnel",
  "google-analytics",
  "node-exporter-full",
  "content-view",
] as const;

export function nativeV2BuiltinDashboardId(templateId: string): string {
  return `builtin-${templateId}`;
}

export const BUILTIN_DASHBOARD_IDS: readonly string[] = [
  BUILTIN_DEMO_DASHBOARD_ID,
  BUILTIN_RISK_MEETING_DASHBOARD_ID,
  ...NATIVE_V2_TEMPLATE_IDS.map(nativeV2BuiltinDashboardId),
  ...SEED_BUILTIN_DASHBOARD_IDS,
];

export function isBuiltinDashboardId(id: string): boolean {
  return BUILTIN_DASHBOARD_IDS.includes(id);
}

const LEGACY_DEMO_ID = /^demo-node-exporter-[0-9a-f]{8}$/;
const LEGACY_NATIVE_ID = /^native-(.+)-[0-9a-f]{10}$/;

/**
 * The built-in a pre-built-in row id was a copy of, or null for an id that
 * never belonged to one. Seed ids map to themselves.
 */
export function builtinDashboardIdForLegacyId(id: string): string | null {
  if (LEGACY_DEMO_ID.test(id)) return BUILTIN_DEMO_DASHBOARD_ID;
  if (id === "risk-meeting") return BUILTIN_RISK_MEETING_DASHBOARD_ID;
  const native = LEGACY_NATIVE_ID.exec(id);
  if (
    native &&
    (NATIVE_V2_TEMPLATE_IDS as readonly string[]).includes(native[1])
  ) {
    return nativeV2BuiltinDashboardId(native[1]);
  }
  if ((SEED_BUILTIN_DASHBOARD_IDS as readonly string[]).includes(id)) return id;
  const settingsCopy = /^(.*)-legacy-[0-9a-f]{32}$/.exec(id);
  if (
    settingsCopy &&
    (SEED_BUILTIN_DASHBOARD_IDS as readonly string[]).includes(settingsCopy[1])
  ) {
    return settingsCopy[1];
  }
  return null;
}

/** The built-in a dashboard id serves when no saved copy wins, or null. */
export function builtinDashboardIdFor(id: string): string | null {
  return isBuiltinDashboardId(id) ? id : builtinDashboardIdForLegacyId(id);
}
