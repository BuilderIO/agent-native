export type WorkspaceTab =
  | "workflows"
  | "items"
  | "activity"
  | "settings"
  | "agents";

export const DEFAULT_WORKSPACE_TAB: WorkspaceTab = "workflows";

const WORKSPACE_TABS: readonly WorkspaceTab[] = [
  "workflows",
  "items",
  "activity",
  "settings",
  "agents",
];

// Tabs the page used to have. A bookmark or an agent link to one of them lands
// on the view that took its place.
const LEGACY_TAB_ALIASES: Record<string, WorkspaceTab> = {
  inbox: "items",
  overview: "workflows",
  automations: "workflows",
  audit: "workflows",
  map: "workflows",
  rules: "workflows",
  history: "workflows",
};

/** Unknown and retired `?tab=` values open Workflows rather than a blank page. */
export function parseWorkspaceTab(value: string | null): WorkspaceTab {
  if (!value) return DEFAULT_WORKSPACE_TAB;
  if ((WORKSPACE_TABS as readonly string[]).includes(value)) {
    return value as WorkspaceTab;
  }
  return LEGACY_TAB_ALIASES[value] ?? DEFAULT_WORKSPACE_TAB;
}

const SHARED_RETAINED_PARAMS = ["factoryId"] as const;

/**
 * The URL params each tab owns. Workflows owns the open workflow and what is
 * selected or replayed on its canvas: `workflow`, `node`, `edge`, `run`, and
 * `version` (a saved version to show in the versions panel). Items and Activity are listed with the
 * filters and selections their views may keep in the URL, so entering one of
 * them with a deep link does not strip them.
 */
const TAB_OWNED_PARAMS: Record<WorkspaceTab, readonly string[]> = {
  workflows: ["workflow", "node", "edge", "run", "version"],
  items: [
    "item",
    "itemId",
    "workflow",
    "node",
    "status",
    "needsYou",
    "parked",
    "source",
    "q",
  ],
  activity: ["workflow", "who", "kind", "range", "since", "until"],
  settings: [],
  agents: [],
};

/** The default tab keeps a bare URL; every other tab names itself. */
export function retainFactoryTabParams(
  current: URLSearchParams,
  tab: WorkspaceTab,
): URLSearchParams {
  const allowed = new Set<string>([
    ...SHARED_RETAINED_PARAMS,
    ...TAB_OWNED_PARAMS[tab],
  ]);
  const next = new URLSearchParams();
  for (const key of allowed) {
    const value = current.get(key);
    if (value) next.set(key, value);
  }
  if (tab !== DEFAULT_WORKSPACE_TAB) next.set("tab", tab);
  return next;
}

export function factorySearchParamsEqual(
  left: URLSearchParams,
  right: URLSearchParams,
): boolean {
  const leftKeys = [...left.keys()].sort();
  const rightKeys = [...right.keys()].sort();
  if (leftKeys.join("\0") !== rightKeys.join("\0")) return false;
  return leftKeys.every((key) => left.get(key) === right.get(key));
}

/** A tab's own URL for a factory. Params of the tab being left are not carried over. */
export function factoryUrlForTab(
  factoryId: string,
  tab: WorkspaceTab,
  current: URLSearchParams = new URLSearchParams(),
): string {
  const next = retainFactoryTabParams(current, tab);
  next.set("factoryId", factoryId);
  const query = next.toString();
  return query ? `/factory?${query}` : "/factory";
}

interface WorkflowLocation {
  workflowId: string;
  nodeId?: string;
  edgeId?: string;
  runId?: string;
  version?: number;
}

/** The URL of a workflow's canvas, with an optional step selected, run replayed, or version shown. */
export function factoryWorkflowUrl(
  factoryId: string,
  location: WorkflowLocation,
): string {
  const next = new URLSearchParams();
  next.set("factoryId", factoryId);
  next.set("workflow", location.workflowId);
  if (location.nodeId) next.set("node", location.nodeId);
  if (location.edgeId) next.set("edge", location.edgeId);
  if (location.runId) next.set("run", location.runId);
  if (location.version !== undefined) {
    next.set("version", String(location.version));
  }
  return `/factory?${next.toString()}`;
}

function readVersion(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const version = Number(value);
  return Number.isSafeInteger(version) && version >= 1 ? version : null;
}

/** What the workflows tab has open, read from the URL. */
export function readWorkflowParams(params: URLSearchParams): {
  workflowId: string | null;
  nodeId: string | null;
  edgeId: string | null;
  runId: string | null;
  version: number | null;
} {
  return {
    workflowId: params.get("workflow") || null,
    nodeId: params.get("node") || null,
    edgeId: params.get("edge") || null,
    runId: params.get("run") || null,
    version: readVersion(params.get("version")),
  };
}

/**
 * Whether moving between two locations leaves the workflow being edited.
 * Selecting a step or replaying a run only rewrites `node`, `edge`, `run` and
 * `version`, which is not leaving; a different path, factory, tab or workflow is.
 */
export function leavesOpenWorkflow(
  current: { pathname: string; search: string },
  next: { pathname: string; search: string },
): boolean {
  if (current.pathname !== next.pathname) return true;
  const from = new URLSearchParams(current.search);
  const to = new URLSearchParams(next.search);
  if (parseWorkspaceTab(from.get("tab")) !== parseWorkspaceTab(to.get("tab"))) {
    return true;
  }
  return ["factoryId", "workflow"].some(
    (key) => (from.get(key) ?? "") !== (to.get(key) ?? ""),
  );
}

interface FactoryNavigationState {
  factoryId?: string;
  factoryTab?: WorkspaceTab;
  workflowId?: string;
  nodeId?: string;
  edgeId?: string;
  runId?: string;
  factoryItemId?: string;
}

/**
 * What the Factory page shows, for the agent's `navigation` state. Workflow
 * fields are reported only on the Workflows tab, where `workflow` names the
 * open canvas rather than a filter, and a step or run only with its workflow.
 */
export function factoryNavigationState(
  params: URLSearchParams,
): FactoryNavigationState {
  const factoryId = params.get("factoryId");
  const rawTab = params.get("tab");
  if (!factoryId && !rawTab) return {};
  const tab = parseWorkspaceTab(rawTab);
  const open = tab === "workflows" ? readWorkflowParams(params) : null;
  const itemId = params.get("item") ?? params.get("itemId");
  return {
    ...(factoryId ? { factoryId } : {}),
    factoryTab: tab,
    ...(open?.workflowId
      ? {
          workflowId: open.workflowId,
          ...(open.nodeId ? { nodeId: open.nodeId } : {}),
          ...(open.edgeId ? { edgeId: open.edgeId } : {}),
          ...(open.runId ? { runId: open.runId } : {}),
        }
      : {}),
    ...(tab === "items" && itemId ? { factoryItemId: itemId } : {}),
  };
}
