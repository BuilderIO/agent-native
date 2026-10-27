import type { ActionEntry } from "../agent/production-agent.js";

const FRAMEWORK_MCP_TOOL = Symbol.for("agent-native.framework-mcp-tool");

type FrameworkEntry = ActionEntry & { [FRAMEWORK_MCP_TOOL]?: true };

export function frameworkMcpTool<T extends ActionEntry>(entry: T): T {
  return { ...entry, [FRAMEWORK_MCP_TOOL]: true };
}

export function frameworkMcpTools<T extends Record<string, ActionEntry>>(
  entries: T,
): T {
  return Object.fromEntries(
    Object.entries(entries).map(([name, entry]) => [
      name,
      frameworkMcpTool(entry),
    ]),
  ) as T;
}

export function isFrameworkMcpTool(entry: ActionEntry): boolean {
  return (entry as FrameworkEntry)[FRAMEWORK_MCP_TOOL] === true;
}

export function carryFrameworkMcpTool(from: ActionEntry, to: object): void {
  if (isFrameworkMcpTool(from)) {
    Object.defineProperty(to, FRAMEWORK_MCP_TOOL, {
      value: true,
      enumerable: true,
    });
  }
}

export function preferMcpAppActions(
  actions: Record<string, ActionEntry>,
  appActions: Partial<Record<string, ActionEntry>>,
): Record<string, ActionEntry> {
  return Object.fromEntries(
    Object.entries(actions).map(([name, entry]) => {
      const appEntry = appActions[name];
      return [
        name,
        isFrameworkMcpTool(entry) &&
        appEntry !== undefined &&
        !isFrameworkMcpTool(appEntry)
          ? appEntry
          : entry,
      ];
    }),
  );
}
