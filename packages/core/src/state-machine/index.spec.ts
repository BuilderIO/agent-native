import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import { defineMachine, StateMachineError } from "./index.js";

// The definitions below are deliberately malformed, so the type-level checks
// in index.test-d.ts do not apply to them.
const build = defineMachine as unknown as (def: unknown) => unknown;

const valid = {
  id: "t",
  states: ["a", "b"],
  initial: "a",
  terminal: ["b"],
  transitions: { go: { from: ["a"], to: "b" } },
};

function definitionError(def: unknown): StateMachineError {
  return thrownError(() => build(def));
}

function thrownError(call: () => unknown): StateMachineError {
  try {
    call();
  } catch (error) {
    if (error instanceof StateMachineError) return error;
    throw error;
  }
  throw new Error("expected call to throw a StateMachineError");
}

const run = defineMachine({
  id: "run",
  states: ["queued", "running", "paused", "done", "failed"],
  initial: "queued",
  terminal: ["done", "failed"],
  transitions: {
    start: { from: ["queued", "paused"], to: "running" },
    pause: { from: ["running"], to: "paused" },
    finish: { from: ["running"], to: "done" },
    fail: { from: ["queued", "running", "paused"], to: "failed" },
  },
});

describe("defineMachine validation", () => {
  it("accepts a valid machine and freezes its arrays", () => {
    const machine = defineMachine({
      id: "loop",
      states: ["a", "b"],
      initial: "a",
      terminal: [],
      transitions: {
        go: { from: ["a"], to: "b" },
        back: { from: ["b"], to: "a" },
      },
    });
    expect(machine.states).toEqual(["a", "b"]);
    expect(machine.events).toEqual(["go", "back"]);
    expect(Object.isFrozen(machine.states)).toBe(true);
    expect(Object.isFrozen(machine.events)).toBe(true);
    expect(Object.isFrozen(machine.fromStates("go"))).toBe(true);
  });

  it.each([
    ["empty states", { states: [] }, "empty_states"],
    ["duplicate state", { states: ["a", "a", "b"] }, "duplicate_state"],
    ["unknown initial", { initial: "x" }, "unknown_initial"],
    ["unknown terminal", { terminal: ["x"] }, "unknown_terminal"],
    [
      "empty from",
      { transitions: { go: { from: [], to: "b" } } },
      "empty_from",
    ],
    [
      "unknown from",
      { transitions: { go: { from: ["x"], to: "b" } } },
      "unknown_from",
    ],
    [
      "unknown to",
      { transitions: { go: { from: ["a"], to: "x" } } },
      "unknown_to",
    ],
    [
      "transition out of a terminal state",
      {
        terminal: ["b"],
        transitions: {
          go: { from: ["a"], to: "b" },
          back: { from: ["b"], to: "a" },
        },
      },
      "terminal_transition",
    ],
    [
      "non-terminal state with no outgoing transition",
      {
        states: ["a", "b", "c"],
        terminal: ["b"],
        transitions: { go: { from: ["a"], to: "b" } },
      },
      "no_outgoing_transition",
    ],
    [
      "state unreachable from initial",
      {
        states: ["a", "b", "c"],
        terminal: ["c"],
        transitions: {
          go: { from: ["a"], to: "c" },
          loop: { from: ["b"], to: "c" },
        },
      },
      "unreachable_state",
    ],
  ])("rejects %s", (_name, override, reason) => {
    const error = definitionError({ ...valid, ...override });
    expect(error).toBeInstanceOf(StateMachineError);
    expect(error.code).toBe("invalid_definition");
    expect(error.machineId).toBe("t");
    expect(error.details).toMatchObject({ reason });
  });

  it.each(["A", "1a", "a b", "a'b", "", "Queued"])(
    "rejects state name %j that is unsafe to inline into SQL",
    (name) => {
      const error = definitionError({
        ...valid,
        states: [name, "b"],
        initial: name,
        terminal: ["b"],
        transitions: { go: { from: [name], to: "b" } },
      });
      expect(error.details).toMatchObject({
        reason: "invalid_state_name",
        state: name,
      });
    },
  );
});

describe("parseState and isState", () => {
  it("accepts members", () => {
    expect(run.parseState("running")).toBe("running");
    expect(run.isState("done")).toBe(true);
  });

  it.each(["nope", null, 3, undefined])(
    "throws unknown_state for %j",
    (value) => {
      expect(run.isState(value)).toBe(false);
      expect(thrownError(() => run.parseState(value)).code).toBe(
        "unknown_state",
      );
    },
  );
});

describe("transition and can", () => {
  it("applies a legal event", () => {
    expect(run.transition("queued", "start")).toBe("running");
    expect(run.can("queued", "start")).toBe(true);
  });

  it("throws invalid_transition for an illegal event", () => {
    expect(run.can("done", "start")).toBe(false);
    const error = thrownError(() => run.transition("done", "start"));
    expect(error.code).toBe("invalid_transition");
    expect(error.details).toMatchObject({ from: "done", event: "start" });
  });

  it("throws invalid_transition for an unknown event name", () => {
    const unknownEvent = "stop" as "start";
    const error = thrownError(() => run.transition("queued", unknownEvent));
    expect(error.code).toBe("invalid_transition");
  });

  it("throws unknown_state from can for a non-member state", () => {
    const error = thrownError(() => run.can("nope" as "queued", "start"));
    expect(error.code).toBe("unknown_state");
  });
});

describe("fromStates, sqlStateList and isTerminal", () => {
  it("lists the source states for an event", () => {
    expect(run.fromStates("start")).toEqual(["queued", "paused"]);
    expect(run.fromStates("finish")).toEqual(["running"]);
  });

  it("renders source states as an inlinable SQL list", () => {
    expect(run.sqlStateList("start")).toBe("'queued', 'paused'");
    expect(run.sqlStateList("finish")).toBe("'running'");
  });

  it("binds source states in a SQL IN fragment", () => {
    expect(run.sqlIn("start")).toMatchObject({
      sql: "(?, ?)",
      args: ["queued", "paused"],
    });
    expect(run.sqlIn("finish")).toMatchObject({
      sql: "(?)",
      args: ["running"],
    });
  });

  it("reports terminal states", () => {
    expect(run.isTerminal("done")).toBe(true);
    expect(run.isTerminal("running")).toBe(false);
  });
});

describe("shortestPaths", () => {
  it("returns the shortest event sequence to each state", () => {
    const machine = defineMachine({
      id: "paths",
      states: ["a", "b", "c", "d"],
      initial: "a",
      terminal: ["d"],
      transitions: {
        step: { from: ["a"], to: "b" },
        next: { from: ["b"], to: "c" },
        skip: { from: ["a"], to: "c" },
        finish: { from: ["c"], to: "d" },
      },
    });
    const paths = machine.shortestPaths();
    expect(paths.get("a")).toEqual([]);
    expect(paths.get("b")).toEqual(["step"]);
    expect(paths.get("c")).toEqual(["skip"]);
    expect(paths.get("d")).toEqual(["skip", "finish"]);
  });
});

describe("state machine properties", () => {
  it("keeps the state valid, makes terminal states absorbing, and throws exactly when can is false", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...run.events), { maxLength: 30 }),
        (events) => {
          let state = run.initial;
          for (const event of events) {
            expect(run.states).toContain(state);
            const allowed = run.can(state, event);
            if (run.isTerminal(state)) {
              expect(run.events.some((e) => run.can(state, e))).toBe(false);
            }
            if (allowed) {
              state = run.transition(state, event);
            } else {
              const error = thrownError(() => run.transition(state, event));
              expect(error.code).toBe("invalid_transition");
            }
          }
          expect(run.states).toContain(state);
        },
      ),
    );
  });
});
