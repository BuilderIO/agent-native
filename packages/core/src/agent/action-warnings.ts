/**
 * Agent-visible warning channel.
 *
 * A risky operation deep inside an action's call stack (an org repoint, a
 * second organization) has no way to reach the conversation: helpers like
 * `setActiveOrgId(email, orgId, reason)` never receive the action's `ctx`, and
 * `console.warn` reaches server logs nobody reads at decision time. That is how
 * a roster migration repointed 21 accounts' active org, orphaned every vault
 * credential synced under the previous one, and still reported success.
 *
 * `warnAgent()` writes onto the mutable per-run request context, which the agent
 * loop already publishes across the action-invocation boundary. The loop drains
 * it after each tool call and appends the warnings to that tool's result, so the
 * model reads them in the same write that lands in the transcript and ledger.
 *
 * Storage is a module-private `WeakMap` keyed on the run object rather than a
 * new `RequestRunContext` field: no edits to a type every surface depends on,
 * and the per-run key gives the channel natural scoping (warnings from one run
 * can never be suppressed by, or leak into, another).
 */
import {
  getRequestRunContext,
  type RequestRunContext,
} from "../server/request-context.js";

export type AgentWarningSeverity = "advisory" | "critical";

export interface AgentWarning {
  severity: AgentWarningSeverity;
  code: string;
  message: string;
}

const pendingWarnings = new WeakMap<RequestRunContext, AgentWarning[]>();

function formatForConsole(warning: AgentWarning): string {
  return `[agent-native][${warning.severity}:${warning.code}] ${warning.message}`;
}

export function warnAgent(warning: AgentWarning): void {
  const run = getRequestRunContext();
  if (!run) {
    console.warn(formatForConsole(warning));
    return;
  }
  const pending = pendingWarnings.get(run);
  if (!pending) {
    pendingWarnings.set(run, [warning]);
    return;
  }
  if (
    pending.some(
      (existing) =>
        existing.code === warning.code && existing.message === warning.message,
    )
  ) {
    return;
  }
  pending.push(warning);
}

export function drainAgentWarnings(): AgentWarning[] {
  const run = getRequestRunContext();
  if (!run) return [];
  const pending = pendingWarnings.get(run);
  if (!pending || pending.length === 0) return [];
  pendingWarnings.delete(run);
  return pending;
}

export function formatAgentWarningsForToolResult(
  warnings: AgentWarning[],
): string {
  return warnings
    .map(
      (warning) =>
        `<agent-warning severity="${warning.severity}" code="${warning.code}">\n${warning.message}\n</agent-warning>`,
    )
    .join("\n");
}
