export type WorkspaceTab =
  | "overview"
  | "map"
  | "inbox"
  | "rules"
  | "settings"
  | "automations"
  | "agents"
  | "audit"
  | "history";

const TAB_OWNED_PARAMS: Record<WorkspaceTab, readonly string[]> = {
  overview: [],
  map: ["node", "edge"],
  inbox: ["itemId", "status", "risk", "range", "source"],
  rules: [],
  settings: [],
  automations: ["automationId", "createAutomation"],
  agents: [],
  audit: ["auditRunId", "automation", "range"],
  history: [],
};

export function retainFactoryTabParams(
  current: URLSearchParams,
  tab: WorkspaceTab,
): URLSearchParams {
  const allowed = new Set<string>(["factoryId", ...TAB_OWNED_PARAMS[tab]]);
  if (tab !== "inbox") allowed.add("tab");
  const next = new URLSearchParams();
  for (const key of allowed) {
    const value = current.get(key);
    if (value) next.set(key, value);
  }
  if (tab === "inbox") next.delete("tab");
  else next.set("tab", tab);
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

export function factoryUrlForTab(
  factoryId: string,
  tab: WorkspaceTab,
  current: URLSearchParams,
): string {
  const next = retainFactoryTabParams(current, tab);
  next.set("factoryId", factoryId);
  const query = next.toString();
  return query ? `/factory?${query}` : "/factory";
}
