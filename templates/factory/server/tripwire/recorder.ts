import { randomUUID } from "node:crypto";

import {
  DETAILS_MAX_BYTES,
  sanitizeDetails,
  scrub,
  scrubId,
} from "./redact.js";
import type { TripwireRow, TripwireStore } from "./store.js";
import {
  TRIPWIRE_FAILED_PREFIX,
  isEngineInvariant,
  isTripwireCodeOfArea,
  isTripwireSeverity,
  type TripwireEvent,
  type TripwireScope,
} from "./types.js";

export const TRIPWIRE_LOG_PREFIX = "[factory-tripwire]";
export const TRIPWIRE_SUPPRESSED_PREFIX = "[factory-tripwire-suppressed]";

/** The same event, in the same place, is stored this many times a minute. */
export const TRIPWIRE_REPEAT_LIMIT = 5;
const REPEAT_WINDOW_MS = 60_000;
const REPEAT_TABLE_MAX = 1000;
const SCOPE_ID = /^[A-Za-z0-9_.:@+-]{1,200}$/;

interface TripwireRecorderDeps {
  store: TripwireStore;
  now?: () => Date;
  newId?: () => string;
  /** Where the `[factory-tripwire]` line goes: the function log. */
  logLine?: (line: string) => void;
  /** Where a failure to record goes. */
  logFailure?: (line: string) => void;
  /** The platform's way to keep a write alive past the response, when it has one. */
  waitUntil?: () => ((work: Promise<unknown>) => void) | undefined;
}

export interface TripwireRecorder {
  /** Fire and forget: never throws, and says so on `logFailure` when it cannot record. */
  record(event: TripwireEvent): void;
  /** Resolves when every write started so far has finished. Never rejects. */
  flush(): Promise<void>;
}

/** An event the recorder refuses: a code outside the closed list, a bad scope. */
class TripwireRefused extends Error {}

interface Repeat {
  windowStart: number;
  stored: number;
  suppressed: number;
}

function refuse(message: string): never {
  throw new TripwireRefused(message);
}

function optionalId(value: string | undefined): string | null {
  if (value === undefined) return null;
  const id = scrubId(value);
  return id === "" ? null : id;
}

function describeFailure(error: unknown): string {
  return scrub(error instanceof Error ? error.message : String(error));
}

export function createTripwireRecorder(
  deps: TripwireRecorderDeps,
): TripwireRecorder {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => `tw-${randomUUID()}`);
  const logLine = deps.logLine ?? ((line) => console.log(line));
  const logFailure = deps.logFailure ?? ((line) => console.error(line));
  const inflight = new Set<Promise<void>>();
  const repeats = new Map<string, Repeat>();

  function failed(code: unknown, error: unknown): void {
    try {
      logFailure(
        `${TRIPWIRE_FAILED_PREFIX} ${scrub(String(code), 60)}: ${describeFailure(error)}`,
      );
    } catch {
      // coercion-ok: the failure line is the last place to report to; a logger that throws leaves nothing else to tell
    }
  }

  /**
   * Whether this event is stored, and how many of the same event the last
   * minute left out. `first` marks the one event that starts a suppression, so
   * the log says so once, not once per repeat.
   */
  function admit(
    key: string,
    at: number,
  ):
    | { stored: true; suppressedBefore: number }
    | { stored: false; first: boolean } {
    if (repeats.size >= REPEAT_TABLE_MAX) {
      for (const [stale, entry] of repeats) {
        if (at - entry.windowStart >= REPEAT_WINDOW_MS) repeats.delete(stale);
      }
      if (repeats.size >= REPEAT_TABLE_MAX) repeats.clear();
    }
    const entry = repeats.get(key);
    if (!entry || at - entry.windowStart >= REPEAT_WINDOW_MS) {
      repeats.set(key, { windowStart: at, stored: 1, suppressed: 0 });
      return { stored: true, suppressedBefore: entry?.suppressed ?? 0 };
    }
    if (entry.stored < TRIPWIRE_REPEAT_LIMIT) {
      entry.stored += 1;
      return { stored: true, suppressedBefore: 0 };
    }
    entry.suppressed += 1;
    return { stored: false, first: entry.suppressed === 1 };
  }

  function prepare(event: TripwireEvent): {
    row: TripwireRow;
    key: string;
    reserved: { operationId: string | null; invariant: string | undefined };
  } {
    if (!isTripwireCodeOfArea(event.area, event.code)) {
      refuse(
        `"${String(event.code)}" is not a code of area "${String(event.area)}".`,
      );
    }
    if (!isTripwireSeverity(event.severity)) {
      refuse(`"${String(event.severity)}" is not a severity.`);
    }
    if (event.area === "engine" && !isEngineInvariant(event.invariant)) {
      refuse(`"${String(event.invariant)}" is not an engine invariant.`);
    }
    const scope = (event.scope ?? {}) as Partial<TripwireScope>;
    const orgId = scope.orgId ?? "";
    const factoryId = scope.factoryId ?? "";
    if (!SCOPE_ID.test(orgId) || !SCOPE_ID.test(factoryId)) {
      refuse("The event has no valid org and factory to belong to.");
    }
    const workflowId = optionalId(event.workflowId);
    const runId = optionalId(event.runId);
    const nodeId = optionalId(event.nodeId);
    const operationId = optionalId(event.operationId);
    const invariant = event.area === "engine" ? event.invariant : undefined;
    const key = [
      orgId,
      factoryId,
      workflowId,
      event.area,
      event.code,
      invariant,
      nodeId,
      operationId,
    ].join("|");
    return {
      key,
      reserved: { operationId, invariant },
      row: {
        id: newId(),
        orgId,
        factoryId,
        workflowId,
        runId,
        nodeId,
        area: event.area,
        code: event.code,
        severity: event.severity,
        detailsJson: "{}",
        createdAt: now().toISOString(),
      },
    };
  }

  function detailsFor(
    event: TripwireEvent,
    reserved: { operationId: string | null; invariant: string | undefined },
    suppressed: number,
  ): string {
    const fixed = {
      ...(reserved.operationId ? { operationId: reserved.operationId } : {}),
      ...(reserved.invariant ? { invariant: reserved.invariant } : {}),
      ...(suppressed > 0 ? { suppressed } : {}),
    };
    const room =
      DETAILS_MAX_BYTES -
      new TextEncoder().encode(JSON.stringify(fixed)).length;
    const { fields, droppedFields } = sanitizeDetails(event.details, {
      maxBytes: room,
    });
    return JSON.stringify({
      ...fixed,
      ...fields,
      ...(droppedFields > 0 ? { droppedFields } : {}),
    });
  }

  async function write(row: TripwireRow): Promise<void> {
    try {
      await deps.store.insert(row);
    } catch (error) {
      failed(row.code, error);
      return;
    }
    try {
      await deps.store.prune({ orgId: row.orgId, factoryId: row.factoryId });
    } catch (error) {
      // The event is stored; only the retention step failed, and it says so.
      failed(`${row.code} (retention)`, error);
    }
  }

  return {
    record(event) {
      try {
        const { row, key, reserved } = prepare(event);
        const admitted = admit(key, now().getTime());
        const summary = {
          area: row.area,
          code: row.code,
          severity: row.severity,
          orgId: row.orgId,
          factoryId: row.factoryId,
          workflowId: row.workflowId,
          runId: row.runId,
          nodeId: row.nodeId,
        };
        if (!admitted.stored) {
          if (admitted.first) {
            logLine(
              `${TRIPWIRE_SUPPRESSED_PREFIX} ${JSON.stringify({ ...summary, limit: TRIPWIRE_REPEAT_LIMIT })}`,
            );
          }
          return;
        }
        row.detailsJson = detailsFor(
          event,
          reserved,
          admitted.suppressedBefore,
        );
        logLine(
          `${TRIPWIRE_LOG_PREFIX} ${JSON.stringify({ id: row.id, at: row.createdAt, ...summary, details: JSON.parse(row.detailsJson) })}`,
        );
        const work = write(row).catch((error: unknown) =>
          failed(row.code, error),
        );
        inflight.add(work);
        void work.finally(() => inflight.delete(work));
        deps.waitUntil?.()?.(work);
      } catch (error) {
        failed(
          error instanceof TripwireRefused
            ? "refused"
            : (event?.code ?? "unknown"),
          error,
        );
      }
    },

    async flush() {
      await Promise.allSettled([...inflight]);
    },
  };
}
