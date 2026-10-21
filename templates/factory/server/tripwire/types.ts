/**
 * What a tripwire is: a cheap check at a risky boundary that, when something
 * unexpected happens, records ONE typed event (ids, status codes, durations,
 * counts, and the structure of data, never raw values) and never changes
 * behavior. This file is the pure vocabulary: it imports nothing, so the
 * workflow engine can name an event through `adapter.ts` without reaching
 * into the host. The writer lives in `recorder.ts`, redaction in `redact.ts`.
 */

/** The closed list of codes, by area. A code outside it is refused at run time. */
export const TRIPWIRE_CODES = {
  provider: [
    "provider_shape_unexpected",
    "provider_status_unexpected",
    "provider_slow",
    "provider_write_ambiguous",
  ],
  builder: [
    "builder_route_unexpected",
    "builder_branch_name_changed",
    "builder_queue_semantics",
    "builder_flag_off",
  ],
  merge: ["merge_gate_snapshot", "merge_blocked", "merge_unexpected_response"],
  ai: ["ai_output_rejected", "ai_output_empty", "ai_slow", "ai_turn_failed"],
  engine: ["engine_invariant"],
  scheduler: [
    "wait_overdue",
    "tick_missed",
    "runner_stale_active",
    "run_dispatch_failed",
    "run_skipped_already_running",
  ],
  agent: ["agent_tool_slow", "agent_write_rejected"],
  gate: ["dispatch_gate_blocked", "operation_gate_denied"],
  credential: ["connection_status_mismatch", "credential_source_used"],
} as const;

export type TripwireArea = keyof typeof TRIPWIRE_CODES;
export type TripwireCodeOf<Area extends TripwireArea> =
  (typeof TRIPWIRE_CODES)[Area][number];
export type TripwireCode = TripwireCodeOf<TripwireArea>;

export const TRIPWIRE_AREAS = Object.keys(TRIPWIRE_CODES) as TripwireArea[];

/** What `engine_invariant` says broke. Carried on the event as `invariant`. */
export const ENGINE_INVARIANTS = [
  "receipt_started_without_ref_on_resume",
  "wake_without_context",
  "cursor_not_advanced_after_complete_run",
  "parked_item_state_missing",
  "duplicate_receipt_key",
  "loop_counter_mismatch",
  "tick_overlap",
] as const;
export type EngineInvariant = (typeof ENGINE_INVARIANTS)[number];

export const TRIPWIRE_FAILED_PREFIX = "[factory-tripwire-failed]";

export const TRIPWIRE_SEVERITIES = ["info", "warn", "error"] as const;
export type TripwireSeverity = (typeof TRIPWIRE_SEVERITIES)[number];

/** The words `credential_source_used` uses for `details.source`. */
export const CREDENTIAL_SOURCES = [
  "workspace-connection",
  "vault",
  "env",
  "none",
] as const;
export type CredentialSource = (typeof CREDENTIAL_SOURCES)[number];

export interface TripwireScope {
  readonly orgId: string;
  readonly factoryId: string;
}

/**
 * Extra facts, by field name. Only these survive into storage: finite numbers,
 * booleans, null, short strings (token-scrubbed, 200 characters), and
 * objects or arrays reduced to their structure (key names and type names,
 * never values). Anything else is dropped and counted in `droppedFields`.
 * Pass raw bodies if that is easiest: they are stored as shapes.
 */
export type TripwireDetails = Readonly<Record<string, unknown>>;

interface TripwireFields {
  severity: TripwireSeverity;
  workflowId?: string;
  runId?: string;
  nodeId?: string;
  operationId?: string;
  details?: TripwireDetails;
}

type AreaVariants = {
  [Area in TripwireArea]: Area extends "engine"
    ? { area: "engine"; code: "engine_invariant"; invariant: EngineInvariant }
    : { area: Area; code: TripwireCodeOf<Area>; invariant?: never };
}[TripwireArea];

/**
 * What a call site hands over: the scope is the host's to fill, so a caller
 * cannot write into another factory.
 */
export type TripwireInput = TripwireFields & AreaVariants;

/** An event with the scope it belongs to, as `recordTripwire` takes it. */
export type TripwireEvent = TripwireInput & { scope: TripwireScope };

/**
 * The port on `WorkflowHost`. Fire and forget: it returns nothing, never
 * throws, and a failure to record is logged, never raised into the caller.
 */
export type TripwireSink = (input: TripwireInput) => void;

function isTripwireArea(value: unknown): value is TripwireArea {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(TRIPWIRE_CODES, value)
  );
}

export function isTripwireCodeOfArea(area: unknown, code: unknown): boolean {
  if (!isTripwireArea(area)) return false;
  return (TRIPWIRE_CODES[area] as readonly unknown[]).includes(code);
}

export function isEngineInvariant(value: unknown): value is EngineInvariant {
  return (ENGINE_INVARIANTS as readonly unknown[]).includes(value);
}

export function isTripwireSeverity(value: unknown): value is TripwireSeverity {
  return (TRIPWIRE_SEVERITIES as readonly unknown[]).includes(value);
}
