import type { TripwireInput, TripwireSink } from "../adapter.js";

type EngineEvent = Extract<TripwireInput, { area: "engine" }>;

/** What a call site says about a broken invariant; the tick adds the workflow and the run. */
export type InvariantReport = Pick<
  EngineEvent,
  "invariant" | "severity" | "nodeId" | "operationId" | "details"
>;

/**
 * Binds `host.tripwire` to one run. Reporting is observe only: it returns
 * nothing and the engine does the same with it or without it.
 */
export function bindInvariantReporter(
  sink: TripwireSink | undefined,
  ids: { workflowId: string; runId: string },
): (report: InvariantReport) => void {
  return (report) =>
    sink?.({ area: "engine", code: "engine_invariant", ...ids, ...report });
}
