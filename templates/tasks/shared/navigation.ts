/** Agent-facing view names for navigate + view-screen parity. */
import { INCLUDE_DONE_QUERY_VALUE } from "./boolean-param.js";

export const NAV_VIEWS = [
  "tasks",
  "inbox",
  "fields",
  "extensions",
  "team",
] as const;

export type NavView = (typeof NAV_VIEWS)[number];

export const VIEW_ROUTES: Record<NavView, string> = {
  tasks: "/tasks",
  inbox: "/inbox",
  fields: "/fields",
  extensions: "/extensions",
  team: "/team",
};

const NAV_VIEW_ALIAS_NAMES = ["home", "ask"] as const;

export type NavViewAlias = (typeof NAV_VIEW_ALIAS_NAMES)[number];

export const NAV_VIEW_ALIASES: Record<string, NavView> = {
  home: "tasks",
  ask: "tasks",
};

export const NAV_VIEW_INPUTS = [...NAV_VIEWS, ...NAV_VIEW_ALIAS_NAMES] as const;

export type NavViewInput = (typeof NAV_VIEW_INPUTS)[number];

export function resolveNavView(view: NavViewInput): NavView {
  return view in NAV_VIEW_ALIASES
    ? NAV_VIEW_ALIASES[view as NavViewAlias]
    : (view as NavView);
}

export interface NavigationState {
  view: NavView;
  path?: string;
  includeDone?: boolean;
  taskId?: string;
  inboxItemId?: string;
  fieldId?: string;
}

export interface NavigateCommand {
  view?: NavView;
  includeDone?: boolean;
  taskId?: string;
  inboxItemId?: string;
  fieldId?: string;
}

/** UI bulk-selection state synced from list views for view-screen. */
export interface ListSelectionAppState {
  selectionMode: boolean;
  selectedIds: string[];
}

/** UI-selected custom field columns shown on task cards. */
export interface TaskCardFieldsState {
  fieldIds: string[];
}

export function viewForPath(pathname: string): NavView {
  for (const view of NAV_VIEWS) {
    if (pathname.startsWith(VIEW_ROUTES[view])) return view;
  }
  return "tasks";
}

export function pathForView(view?: NavView): string {
  if (view && view in VIEW_ROUTES) return VIEW_ROUTES[view];
  return VIEW_ROUTES.tasks;
}

export function buildNavigatePath(
  basePath: string,
  command: NavigateCommand,
  current?: Pick<NavigationState, "includeDone">,
): string {
  const params = new URLSearchParams();
  if (command.taskId) params.set("task", command.taskId);
  if (command.inboxItemId) params.set("inboxItem", command.inboxItemId);
  if (command.fieldId) params.set("field", command.fieldId);
  const includeDone =
    command.includeDone !== undefined
      ? command.includeDone
      : navigatesToTasks(basePath) && current?.includeDone === true;
  if (includeDone) params.set("includeDone", INCLUDE_DONE_QUERY_VALUE);
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

function navigatesToTasks(basePath: string): boolean {
  return (
    basePath === VIEW_ROUTES.tasks ||
    basePath.startsWith(`${VIEW_ROUTES.tasks}/`)
  );
}
