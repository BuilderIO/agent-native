import { type ComponentType, lazy } from "react";

/**
 * Validates that a dashboard entry has all required metadata fields.
 * Called at module load time to catch missing fields during development.
 */
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
      `❌ Dashboard '${dashboard.id}' (${dashboard.name}) is missing required metadata:\n` +
        errors.map((e) => `  - ${e}`).join("\n") +
        "\n\n⚠️  REQUIRED: Provide author name manually when creating dashboards." +
        "\n   Update the dashboard entry in app/pages/adhoc/registry.ts",
    );
  }
}

export interface DashboardSubview {
  id: string;
  name: string;
  /** URL query params to apply when navigating to this subview */
  params: Record<string, string>;
}

export interface DashboardMeta {
  id: string;
  name: string;
  subviews?: DashboardSubview[];
  description?: string;
  dateCreated?: string; // YYYY-MM-DD format

  /**
   * REQUIRED: Email or name of the person who created this dashboard.
   * This MUST be manually provided by the creator - NOT pulled from git logs.
   * Examples: "jane@example.com" or "Jane Doe"
   */
  author: string;

  /**
   * REQUIRED: Last modification date in YYYY-MM-DD format.
   * Set to today's date when creating. Update when making changes.
   */
  lastUpdated: string;
}

// Add new dashboards here. Each entry needs a matching file in this directory.
// REQUIRED FIELDS: id, name, author, lastUpdated
export const dashboards: DashboardMeta[] = [
  {
    id: "key-metrics",
    name: "Key Metrics",
    author: "Template",
    lastUpdated: "2025-01-15",
  },
  {
    id: "content-calendar",
    name: "Content SEO",
    author: "Template",
    lastUpdated: "2025-02-15",
  },
  {
    id: "hubspot",
    name: "HubSpot Sales",
    author: "Template",
    lastUpdated: "2025-01-30",
  },
  {
    id: "sentry",
    name: "Sentry Error Health",
    author: "Template",
    lastUpdated: "2025-02-25",
  },
  {
    id: "gcloud",
    name: "Google Cloud Health",
    author: "Template",
    lastUpdated: "2025-02-28",
  },
  {
    id: "jira",
    name: "Jira Tickets",
    author: "Template",
    lastUpdated: "2025-03-02",
  },
  {
    id: "stripe",
    name: "Stripe Billing",
    author: "Template",
    lastUpdated: "2025-03-04",
  },
  {
    id: "onboarding-funnel",
    name: "Onboarding Funnel Analysis",
    author: "Template",
    lastUpdated: "2025-03-06",
  },
  {
    id: "pr-review-bot",
    name: "PR Review Bot",
    author: "Template",
    lastUpdated: "2025-03-10",
  },
];

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

// Lazy-load dashboard components by ID.
// When adding a new dashboard, add a lazy import here matching the id above.
export const dashboardComponents: Record<
  string,
  React.LazyExoticComponent<ComponentType>
> = {
  "key-metrics": lazy(() => import("./key-metrics")),
  "content-calendar": lazy(() => import("./content-calendar")),
  hubspot: lazy(() => import("./hubspot")),
  "customer-health": lazy(() => import("./customer-health")),
  sentry: lazy(() => import("./sentry")),
  gcloud: lazy(() => import("./gcloud")),
  "slack-feedback": lazy(() => import("./slack-feedback")),
  jira: lazy(() => import("./jira")),
  stripe: lazy(() => import("./stripe")),
  "onboarding-funnel": lazy(() => import("./onboarding-funnel")),

  explorer: lazy(() => import("./explorer")),
  "explorer-dashboard": lazy(() => import("./explorer-dashboard")),
  "pr-review-bot": lazy(() => import("./pr-review-bot")),
};

// Validate all dashboards at module load time
// This catches missing metadata during development
if (import.meta.env.DEV) {
  dashboards.forEach(validateDashboard);
}
