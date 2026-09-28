import { type ComponentType, lazy } from "react";

function validateDashboard(dashboard: DashboardMeta): void {
  const errors: string[] = [];

  if (!dashboard.author) {
    errors.push(
      `Missing 'author' field - YOU MUST provide the creator's name or email (e.g., "jane@example.com" or "Jane Doe")`,
    );
  }

  if (!dashboard.lastUpdated) {
    errors.push(
      `Missing 'lastUpdated' field - set to today's date in YYYY-MM-DD format`,
    );
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(dashboard.lastUpdated)) {
    errors.push(
      `'lastUpdated' must be in YYYY-MM-DD format, got: ${dashboard.lastUpdated}`,
    );
  }

  if (errors.length > 0) {
    console.error(
      `Dashboard '${dashboard.id}' (${dashboard.name}) is missing required metadata:\n` +
        errors.map((e) => `  - ${e}`).join("\n") +
        "\n\nREQUIRED: Provide author name manually when creating dashboards." +
        "\n   Update the dashboard entry in app/pages/adhoc/registry.ts",
    );
  }
}

export interface DashboardSubview {
  id: string;
  name: string;
  params: Record<string, string>;
}

export interface DashboardMeta {
  id: string;
  name: string;
  subviews?: DashboardSubview[];
  description?: string;
  dateCreated?: string;

  author: string;

  lastUpdated: string;
}

export const dashboards: DashboardMeta[] = [];

const HIDDEN_KEY = "hidden-dashboards";

export function getHiddenDashboards(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

export function hideDashboard(id: string) {
  const hidden = getHiddenDashboards();
  hidden.add(id);
  localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
}

export function restoreDashboard(id: string) {
  const hidden = getHiddenDashboards();
  hidden.delete(id);
  localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
}

const DASHBOARD_ORDER_KEY = "dashboard-order";
const TOOLS_ORDER_KEY = "tools-order";

export function getDashboardOrder(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DASHBOARD_ORDER_KEY) || "[]");
  } catch {
    return [];
  }
}

export function setDashboardOrder(order: string[]) {
  localStorage.setItem(DASHBOARD_ORDER_KEY, JSON.stringify(order));
}

export function getToolsOrder(): string[] {
  try {
    return JSON.parse(localStorage.getItem(TOOLS_ORDER_KEY) || "[]");
  } catch {
    return [];
  }
}

export function setToolsOrder(order: string[]) {
  localStorage.setItem(TOOLS_ORDER_KEY, JSON.stringify(order));
}

const FAVORITES_KEY = "favorite-dashboards";

export function getFavoriteDashboards(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

export function toggleFavoriteDashboard(id: string): Set<string> {
  const favs = getFavoriteDashboards();
  if (favs.has(id)) {
    favs.delete(id);
  } else {
    favs.add(id);
  }
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favs]));
  return favs;
}

export const dashboardComponents: Partial<
  Record<string, React.LazyExoticComponent<ComponentType>>
> = {
  explorer: lazy(() => import("./explorer")),
  "explorer-dashboard": lazy(() => import("./explorer-dashboard")),
};

if (import.meta.env.DEV) {
  dashboards.forEach(validateDashboard);
}
