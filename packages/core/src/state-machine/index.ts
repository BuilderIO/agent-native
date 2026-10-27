/**
 * Typed lifecycle state machines for states persisted in SQL.
 *
 * A machine is plain data. `defineMachine` validates it once at module load,
 * then the same definition answers runtime checks, `WHERE status IN (...)`
 * clauses, and shortest-path fixtures for tests.
 */

const STATE_NAME = /^[a-z][a-z0-9_-]*$/;

export class StateMachineError extends Error {
  readonly code: "unknown_state" | "invalid_transition" | "invalid_definition";
  readonly machineId: string;
  readonly details: Record<string, unknown>;

  constructor(
    code: StateMachineError["code"],
    machineId: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(`${machineId}: ${message}`);
    this.name = "StateMachineError";
    this.code = code;
    this.machineId = machineId;
    this.details = details;
  }
}

export interface Machine<S extends string, E extends string> {
  readonly id: string;
  readonly states: readonly S[];
  readonly events: readonly E[];
  readonly initial: S;
  isState(value: unknown): value is S;
  parseState(value: unknown): S;
  can(from: S, event: E): boolean;
  transition(from: S, event: E): S;
  fromStates(event: E): readonly S[];
  sqlStateList(event: E): string;
  isTerminal(state: S): boolean;
  shortestPaths(): ReadonlyMap<S, readonly E[]>;
}

interface Transition<S extends string, E extends string> {
  readonly event: E;
  readonly from: ReadonlySet<S>;
  readonly fromStates: readonly S[];
  readonly to: S;
}

function invalidDefinition(
  machineId: string,
  message: string,
  details: Record<string, unknown>,
): StateMachineError {
  return new StateMachineError(
    "invalid_definition",
    machineId,
    message,
    details,
  );
}

function assertKnown(
  known: ReadonlySet<string>,
  machineId: string,
  reason: string,
  state: string,
  details: Record<string, unknown> = {},
): void {
  if (!known.has(state)) {
    throw invalidDefinition(machineId, `state "${state}" is not in states`, {
      reason,
      state,
      ...details,
    });
  }
}

function describeValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  return value === null ? "null" : typeof value;
}

export function defineMachine<
  const S extends string,
  const E extends string,
>(def: {
  id: string;
  states: readonly S[];
  // NoInfer keeps `states` as the only place state names are inferred from.
  // Without it, a misspelled initial/terminal/from/to would widen S instead
  // of failing to compile.
  initial: NoInfer<S>;
  terminal: readonly NoInfer<S>[];
  transitions: {
    readonly [K in E]: {
      readonly from: readonly NoInfer<S>[];
      readonly to: NoInfer<S>;
    };
  };
}): Machine<S, E> {
  const { id } = def;
  const states = Object.freeze([...def.states]);
  if (states.length === 0) {
    throw invalidDefinition(id, "states must not be empty", {
      reason: "empty_states",
    });
  }

  const known = new Set<string>();
  for (const state of states) {
    if (known.has(state)) {
      throw invalidDefinition(id, `state "${state}" is duplicated`, {
        reason: "duplicate_state",
        state,
      });
    }
    if (!STATE_NAME.test(state)) {
      throw invalidDefinition(id, `state "${state}" must match ${STATE_NAME}`, {
        reason: "invalid_state_name",
        state,
      });
    }
    known.add(state);
  }

  const initial: S = def.initial;
  assertKnown(known, id, "unknown_initial", initial);

  const terminal = new Set<string>();
  for (const state of def.terminal) {
    assertKnown(known, id, "unknown_terminal", state);
    terminal.add(state);
  }

  const transitions: Array<Transition<S, E>> = [];
  const byEvent = new Map<string, Transition<S, E>>();
  for (const event of Object.keys(def.transitions) as E[]) {
    const { from, to } = def.transitions[event];
    if (from.length === 0) {
      throw invalidDefinition(id, `event "${event}" has no source states`, {
        reason: "empty_from",
        event,
      });
    }
    assertKnown(known, id, "unknown_to", to, { event });
    for (const state of from) {
      assertKnown(known, id, "unknown_from", state, { event });
      if (terminal.has(state)) {
        throw invalidDefinition(
          id,
          `terminal state "${state}" cannot transition on "${event}"`,
          { reason: "terminal_transition", state, event },
        );
      }
    }
    const fromStates = Object.freeze([...new Set(from)]);
    const transition: Transition<S, E> = {
      event,
      from: new Set(fromStates),
      fromStates,
      to,
    };
    transitions.push(transition);
    byEvent.set(event, transition);
  }

  const hasOutgoing = new Set(transitions.flatMap((t) => t.fromStates));
  for (const state of states) {
    if (!terminal.has(state) && !hasOutgoing.has(state)) {
      throw invalidDefinition(
        id,
        `non-terminal state "${state}" has no outgoing transition`,
        { reason: "no_outgoing_transition", state },
      );
    }
  }

  // Map iteration visits entries added during the loop, so this is a
  // breadth-first search. Insertion order makes each path a shortest one.
  const paths = new Map<S, readonly E[]>([[initial, Object.freeze([])]]);
  for (const [state, path] of paths) {
    for (const { event, from, to } of transitions) {
      if (from.has(state) && !paths.has(to)) {
        paths.set(to, Object.freeze([...path, event]));
      }
    }
  }
  for (const state of states) {
    if (!paths.has(state)) {
      throw invalidDefinition(
        id,
        `state "${state}" is unreachable from "${initial}"`,
        { reason: "unreachable_state", state },
      );
    }
  }

  const events = Object.freeze(transitions.map((t) => t.event));

  const isState = (value: unknown): value is S =>
    typeof value === "string" && known.has(value);

  const parseState = (value: unknown): S => {
    if (isState(value)) return value;
    throw new StateMachineError(
      "unknown_state",
      id,
      `unknown state ${describeValue(value)}`,
      { value, states },
    );
  };

  const ruleFor = (event: E): Transition<S, E> => {
    const found = byEvent.get(event);
    if (!found) {
      throw new StateMachineError(
        "invalid_transition",
        id,
        `unknown event "${event}"`,
        { event, events },
      );
    }
    return found;
  };

  return Object.freeze({
    id,
    states,
    events,
    initial,
    isState,
    parseState,
    can(from: S, event: E): boolean {
      return ruleFor(event).from.has(parseState(from));
    },
    transition(from: S, event: E): S {
      const rule = ruleFor(event);
      const current = parseState(from);
      if (!rule.from.has(current)) {
        throw new StateMachineError(
          "invalid_transition",
          id,
          `cannot apply "${event}" from "${current}"`,
          { from: current, event, allowed: rule.fromStates },
        );
      }
      return rule.to;
    },
    fromStates(event: E): readonly S[] {
      return ruleFor(event).fromStates;
    },
    sqlStateList(event: E): string {
      // Names are restricted to [a-z0-9_-] above, so they need no SQL escaping.
      return ruleFor(event)
        .fromStates.map((state) => `'${state}'`)
        .join(", ");
    },
    isTerminal(state: S): boolean {
      return terminal.has(parseState(state));
    },
    shortestPaths(): ReadonlyMap<S, readonly E[]> {
      return paths;
    },
  });
}
