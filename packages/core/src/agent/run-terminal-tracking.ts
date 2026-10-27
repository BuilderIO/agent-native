import type { TrackingMeta } from "../tracking/registry.js";
import { runErrorTelemetryProperties } from "./engine/error-telemetry.js";
import type { UnknownWriteCause } from "./types.js";

export interface RunTerminalTrackingFields {
  runId: string;
  threadId: string;
  turnId: string;
  status: "completed" | "errored" | "aborted" | "truncated";
  terminalReason: string;
  errorCode?: string;
  dispatchMode?: string;
  abortReason?: string;
  durationMs?: number;
  model?: string;
  engineName?: string;
  attemptCount?: number;
  /** For `write_tool_outcome_unknown`: the call held back, and why. */
  blockedTool?: string;
  blockedBy?: UnknownWriteCause;
  /** Set only by a reap, which ends a run outside the process running it. */
  reap?: { source: string; recoveryOutcome?: string };
}

/**
 * The one `agent_run_terminal` sender, shared by the run's own process and the
 * SQL writes that end a run for it, so the two shapes cannot drift apart. The returned promise never
 * rejects, so a caller can hand it to `waitUntil` without guarding it.
 */
export function trackRunTerminal(
  fields: RunTerminalTrackingFields,
  source: TrackingMeta | undefined,
): Promise<void> {
  try {
    const properties: Record<string, unknown> = {
      source: "agent_run_manager",
      run_id: fields.runId,
      thread_id: fields.threadId,
      turn_id: fields.turnId,
      status: fields.status,
      terminal_reason: fields.terminalReason,
      error_code: fields.errorCode,
      ...(fields.errorCode
        ? runErrorTelemetryProperties(fields.errorCode)
        : {}),
      dispatch_mode: fields.dispatchMode,
      abort_reason: fields.abortReason,
      duration_ms: fields.durationMs,
      model: fields.model,
      engine: fields.engineName,
      attempt_count: fields.attemptCount,
      blocked_tool: fields.blockedTool,
      blocked_by: fields.blockedBy,
      ...(fields.reap
        ? {
            reaped: true,
            reap_source: fields.reap.source,
            recovery_outcome: fields.reap.recoveryOutcome,
          }
        : {}),
    };
    for (const key of Object.keys(properties)) {
      if (properties[key] === undefined) delete properties[key];
    }
    return Promise.all([
      import("../tracking/registry.js"),
      import("../observability/tracking-identity.js"),
    ])
      .then(([{ track }, { trackingIdentityProperties }]) => {
        track(
          "agent_run_terminal",
          { ...properties, ...trackingIdentityProperties() },
          source,
        );
      })
      .catch((error: unknown) => {
        console.error(
          "[run-terminal-tracking] agent_run_terminal was not sent:",
          fields.runId,
          error instanceof Error ? error.message : error,
        );
      });
  } catch (error) {
    // Tracking must never affect the agent run or its persisted status.
    console.error(
      "[run-terminal-tracking] agent_run_terminal was not sent:",
      fields.runId,
      error instanceof Error ? error.message : error,
    );
    return Promise.resolve();
  }
}
