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

/**
 * `critical` means the operation probably broke something the user must hear
 * about now; `advisory` means worth mentioning, not worth alarming. Required so
 * a caller cannot get a downgrade by omission.
 */
export type AgentWarningSeverity = "advisory" | "critical";

export interface AgentWarning {
  severity: AgentWarningSeverity;
  /** Stable machine-readable class, e.g. `org-cross-org-repoint`. */
  code: string;
  /** One human sentence: what happened, the consequence, and the remedy. */
  message: string;
}

const pendingWarnings = new WeakMap<RequestRunContext, AgentWarning[]>();

function formatForConsole(warning: AgentWarning): string {
  return `[agent-native][${warning.severity}:${warning.code}] ${warning.message}`;
}

/**
 * Raise a warning for the agent to relay to the user. Safe to call from any
 * depth inside an action; no `ctx` needed.
 */
export function warnAgent(warning: AgentWarning): void {
  const run = getRequestRunContext();
  if (!run) {
    // No agent run to attach to (CLI, migration script, boot). A warning that
    // reaches nobody is the exact failure this channel exists to fix, so the
    // console stays the fallback home instead of the warning being dropped.
    console.warn(formatForConsole(warning));
    return;
  }
  const pending = pendingWarnings.get(run);
  if (!pending) {
    pendingWarnings.set(run, [warning]);
    return;
  }
  // Dedupe only within what the next drain will emit: the same sentence twice in
  // one tool result is noise, but the same warning from a later tool call is a
  // second real operation the user still needs to hear about.
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

/** Take and clear the warnings raised so far in the current run. */
export function drainAgentWarnings(): AgentWarning[] {
  const run = getRequestRunContext();
  if (!run) return [];
  const pending = pendingWarnings.get(run);
  if (!pending || pending.length === 0) return [];
  pendingWarnings.delete(run);
  return pending;
}

/**
 * Render drained warnings as tagged blocks for a tool result. Never called with
 * an empty list by the loop, so an action that raises nothing leaves its result
 * byte-identical.
 */
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
