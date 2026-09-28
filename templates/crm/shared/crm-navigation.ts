import { buildSettingsRoute } from "@agent-native/core/navigation";

/** CRM's own areas: tabs on CRM › General, at `/settings/app/<id>`. */
export const CRM_SETTINGS_AREA_IDS = [
  "connection",
  "fields",
  "lists",
  "intelligence",
  "advanced",
] as const;

export type CrmSettingsAreaId = (typeof CRM_SETTINGS_AREA_IDS)[number];

/** What the navigate action's `settingsSection` can name. */
export const CRM_SETTINGS_SECTIONS = [...CRM_SETTINGS_AREA_IDS, "mcp"] as const;

export type CrmSettingsSection = (typeof CRM_SETTINGS_SECTIONS)[number];

export const CRM_RECORD_KINDS = ["account", "person", "opportunity"] as const;

export type CrmRecordKind = (typeof CRM_RECORD_KINDS)[number];

export const CRM_VIEWS = [
  "work",
  "account",
  "person",
  "opportunity",
  "records",
  "record",
  "lists",
  "views",
  "board",
  "tasks",
  "proposals",
  "dashboard",
  "ask",
  "setup",
  "settings",
] as const;

export type CrmView = (typeof CRM_VIEWS)[number];

export const CRM_VIEW_PATHS: Record<Exclude<CrmView, "record">, string> = {
  work: "/home",
  account: "/accounts",
  person: "/people",
  opportunity: "/opportunities",
  records: "/records",
  lists: "/lists",
  views: "/views",
  board: "/views",
  tasks: "/tasks",
  proposals: "/proposals",
  dashboard: "/dashboard",
  ask: "/ask",
  setup: "/setup",
  settings: "/settings",
};

export interface CrmNavigationTarget {
  view?: string;
  recordId?: string;
  listId?: string;
  viewId?: string;
  dashboardId?: string;
  kind?: CrmRecordKind;
  query?: string;
  settingsSection?: CrmSettingsSection;
}

export function viewFromPath(pathname: string): CrmView {
  if (pathname.startsWith("/records/")) return "record";
  if (pathname.startsWith("/records")) return "records";
  if (pathname.startsWith("/accounts")) return "account";
  if (pathname.startsWith("/people")) return "person";
  if (pathname.startsWith("/opportunities")) return "opportunity";
  if (pathname.startsWith("/lists")) return "lists";
  if (pathname.startsWith("/tasks")) return "tasks";
  if (pathname.startsWith("/proposals")) return "proposals";
  if (pathname.startsWith("/views")) return "views";
  if (pathname.startsWith("/dashboard")) return "dashboard";
  if (pathname.startsWith("/ask")) return "ask";
  if (pathname.startsWith("/setup")) return "setup";
  if (pathname.startsWith("/settings")) return "settings";
  return "work";
}

export function crmNavigationPath(target: CrmNavigationTarget): string {
  if (target.view === "record") {
    if (!target.recordId) {
      throw new Error("recordId is required when navigating to a CRM record.");
    }
    return `/records/${encodeURIComponent(target.recordId)}`;
  }
  if (target.view === "settings" && target.settingsSection) {
    return target.settingsSection === "mcp"
      ? buildSettingsRoute("mcp")
      : buildSettingsRoute("app", target.settingsSection);
  }
  if (target.view === "board" && !target.viewId && !target.listId) {
    throw new Error(
      "listId or viewId is required when navigating to a CRM board; /views on its own is the saved-view index.",
    );
  }

  const params = new URLSearchParams();
  let base =
    CRM_VIEW_PATHS[target.view as Exclude<CrmView, "record">] ?? "/home";
  if (
    (target.view === "views" ||
      target.view === "board" ||
      target.view === "lists") &&
    (target.viewId || target.listId)
  ) {
    base = "/views";
    if (target.viewId) params.set("view", target.viewId);
    else params.set("list", target.listId!);
  }
  if (target.view === "board") params.set("mode", "board");
  if (target.view === "records" && target.kind) params.set("kind", target.kind);
  if (target.view === "dashboard" && target.dashboardId) {
    params.set("id", target.dashboardId);
  }
  if (target.query) params.set("q", target.query);
  return params.size ? `${base}?${params}` : base;
}

export interface CrmNavigationSelection {
  viewId?: string;
  listId?: string;
  dashboardId?: string;
  kind?: CrmRecordKind;
  mode?: "table" | "board";
  query?: string;
  settingsSection?: CrmSettingsSection;
}

export function parseCrmNavigationSelection(
  pathAndSearch: string | null | undefined,
): CrmNavigationSelection | null {
  if (typeof pathAndSearch !== "string" || !pathAndSearch) return null;
  let url: URL;
  try {
    url = new URL(pathAndSearch, "http://crm.invalid");
  } catch {
    return null;
  }
  const params = url.searchParams;
  const kind = params.get("kind");
  const mode = params.get("mode");
  const section = settingsSectionFromPath(url.pathname);
  return {
    ...(params.get("view") ? { viewId: params.get("view")! } : {}),
    ...(params.get("list") ? { listId: params.get("list")! } : {}),
    ...(params.get("id") ? { dashboardId: params.get("id")! } : {}),
    ...(isRecordKind(kind) ? { kind } : {}),
    ...(mode === "table" || mode === "board" ? { mode } : {}),
    ...(params.get("q") ? { query: params.get("q")! } : {}),
    ...(isSettingsSection(section) ? { settingsSection: section } : {}),
  };
}

/**
 * `/settings/app/<area>` in either Settings, plus today's `/settings/<section>`
 * links, which the redesigned shell rewrites to the area.
 */
function settingsSectionFromPath(pathname: string): string | undefined {
  const segments = pathname.split("/settings/")[1]?.split("/") ?? [];
  return segments[0] === "app" ? segments[1] : segments[0];
}

function isRecordKind(value: string | null): value is CrmRecordKind {
  return CRM_RECORD_KINDS.includes(value as CrmRecordKind);
}

function isSettingsSection(
  value: string | undefined,
): value is CrmSettingsSection {
  return CRM_SETTINGS_SECTIONS.includes(value as CrmSettingsSection);
}
