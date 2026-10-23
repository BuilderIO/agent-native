/**
 * Tripwires: an observe-only recorder for the places a workflow can go wrong
 * without anyone noticing. A call site checks something cheap at a risky
 * boundary and, when it is not what was expected, records one typed event.
 * Recording never throws and never changes what the caller does.
 *
 * Two ways in:
 *
 * - Engine code holds no host imports, so it calls the port on its host:
 *   `host.tripwire?.({ area: "engine", code: "engine_invariant", invariant:
 *   "tick_overlap", severity: "error", workflowId, runId, details: { ... } })`.
 *   `createFactoryWorkflowHost` binds the factory, so the event carries no scope.
 * - Host and action code calls `recordTripwire({ ...input, scope })` directly.
 *
 * `details` takes plain fields and anything else is reduced: numbers, booleans,
 * short strings (token-scrubbed), and objects as their structure. Pass the
 * response, not a summary of it: only its shape is stored. Use `errorDetails(error)`
 * for a caught error and `describeShape(value)` to name a structure explicitly.
 */
import { platformWaitUntil } from "@agent-native/core/server";

import { getDb } from "../db/index.js";
import { createTripwireRecorder, type TripwireRecorder } from "./recorder.js";
import { createDrizzleTripwireStore } from "./store.js";
import {
  TRIPWIRE_FAILED_PREFIX,
  type TripwireEvent,
  type TripwireScope,
  type TripwireSink,
} from "./types.js";

export {
  CREDENTIAL_SOURCES,
  ENGINE_INVARIANTS,
  TRIPWIRE_AREAS,
  TRIPWIRE_CODES,
  TRIPWIRE_SEVERITIES,
  type CredentialSource,
  type EngineInvariant,
  type TripwireArea,
  type TripwireCode,
  type TripwireCodeOf,
  type TripwireDetails,
  type TripwireEvent,
  type TripwireInput,
  type TripwireScope,
  type TripwireSeverity,
  type TripwireSink,
} from "./types.js";
export {
  describeShape,
  errorDetails,
  sanitizeDetails,
  scrub,
  scrubId,
  type Shape,
} from "./redact.js";

let defaultRecorder: TripwireRecorder | undefined;

function getDefaultRecorder(): TripwireRecorder {
  defaultRecorder ??= createTripwireRecorder({
    store: createDrizzleTripwireStore({ getDatabase: () => getDb() }),
    waitUntil: () => platformWaitUntil(),
  });
  return defaultRecorder;
}

function reportFailure(error: unknown): void {
  console.error(
    `${TRIPWIRE_FAILED_PREFIX} recorder: ${error instanceof Error ? error.message : String(error)}`,
  );
}

/**
 * Records one event on Factory's database and in the function log. Returns at
 * once; the write finishes in the background (kept alive past the response
 * where the platform has `waitUntil`). Never throws.
 */
export function recordTripwire(event: TripwireEvent): void {
  try {
    getDefaultRecorder().record(event);
  } catch (error) {
    reportFailure(error);
  }
}

/** Resolves when every write started so far has finished; call it at the end of a tick or request. */
export async function flushTripwires(): Promise<void> {
  try {
    await getDefaultRecorder().flush();
  } catch (error) {
    reportFailure(error);
  }
}

/**
 * A sink bound to one factory (and, when given, one workflow), for
 * `WorkflowHost.tripwire` and for any function that records several events.
 * An event's own `workflowId` wins over the default.
 */
export function createTripwireSink(base: {
  scope: TripwireScope;
  workflowId?: string;
  recorder?: Pick<TripwireRecorder, "record">;
}): TripwireSink {
  return (input) => {
    try {
      const recorder = base.recorder ?? getDefaultRecorder();
      recorder.record({
        ...input,
        scope: base.scope,
        workflowId: input.workflowId ?? base.workflowId,
      } as TripwireEvent);
    } catch (error) {
      reportFailure(error);
    }
  };
}
