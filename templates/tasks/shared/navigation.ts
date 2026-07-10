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

const VIEW_ALIASES: Record<string, NavView> = {
  home: "tasks",
  ask: "tasks",
};

export interface NavigationState {
  view: string;
  path?: string;
  includeDone?: boolean;
  taskId?: string;
  inboxItemId?: string;
  fieldId?: string;
}

export interface NavigateCommand {
  view?: string;
  path?: string;
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

export function pathForView(view?: string): string {
  if (view && view in VIEW_ALIASES) {
    return VIEW_ROUTES[VIEW_ALIASES[view]!];
  }
  if (view && view in VIEW_ROUTES) {
    return VIEW_ROUTES[view as NavView];
  }
  return VIEW_ROUTES.tasks;
}

export function buildNavigatePath(
  basePath: string,
  command: NavigateCommand,
): string {
  const params = new URLSearchParams();
  if (command.taskId) params.set("task", command.taskId);
  if (command.inboxItemId) params.set("inboxItem", command.inboxItemId);
  if (command.fieldId) params.set("field", command.fieldId);
  if (command.includeDone) params.set("includeDone", INCLUDE_DONE_QUERY_VALUE);
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}
