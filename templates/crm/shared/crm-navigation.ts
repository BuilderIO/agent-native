/**
 * The CRM navigation vocabulary: which surfaces exist, the path each one lives
 * at, and how to read the current selection back out of a path.
 *
 * The agent (`navigate`, `view-screen`) and the browser route hook have to mean
 * the same thing by "the board for this list", so the view union, the path
 * builder, and the selection parser live here rather than once per surface.
 * Two copies of this map is how the agent ends up navigating somewhere the UI
 * does not report back.
 */

export const CRM_SETTINGS_SECTIONS = [
  "connection",
  "fields",
  "lists",
  "intelligence",
  "advanced",
] as const;

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

/**
 * `board` shares the `/views` route: a board is a presentation mode of one
 * saved view or list, not a route of its own. `viewFromPath` therefore never
 * returns it — only `navigate` accepts it as a destination.
 */
export const CRM_VIEW_PATHS: Record<Exclude<CrmView, "record">, string> = {
  work: "/",
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

/**
 * The complete path — including search — for a navigation target.
 *
 * A destination the UI cannot actually open is thrown, not silently degraded to
 * an index page: "navigated to the board" while the board never opened is the
 * failure mode the root CLAUDE.md forbids.
 */
export function crmNavigationPath(target: CrmNavigationTarget): string {
  if (target.view === "record") {
    if (!target.recordId) {
      throw new Error("recordId is required when navigating to a CRM record.");
    }
    return `/records/${encodeURIComponent(target.recordId)}`;
  }
  if (target.view === "settings" && target.settingsSection) {
    return `/settings/${target.settingsSection}`;
  }
  if (target.view === "board" && !target.viewId && !target.listId) {
    throw new Error(
      "listId or viewId is required when navigating to a CRM board; /views on its own is the saved-view index.",
    );
  }

  const params = new URLSearchParams();
  let base = CRM_VIEW_PATHS[target.view as Exclude<CrmView, "record">] ?? "/";
  // A saved view or a list always opens on the /views surface; /lists is only
  // the index of lists.
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

/**
 * The selection carried by a visited path. `null` means no path was published
 * — which is not the same as a path with nothing selected, and callers must be
 * able to tell those apart.
 */
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
  const section = url.pathname.split("/settings/")[1]?.split("/")[0];
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

function isRecordKind(value: string | null): value is CrmRecordKind {
  return CRM_RECORD_KINDS.includes(value as CrmRecordKind);
}

function isSettingsSection(
  value: string | undefined,
): value is CrmSettingsSection {
  return CRM_SETTINGS_SECTIONS.includes(value as CrmSettingsSection);
}
