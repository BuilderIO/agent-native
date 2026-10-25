// Compile-time proofs for the state machine types, checked by
// tsconfig.type-tests.json. Each expect-error directive below fails the check
// if its line stops being an error.
import { defineMachine } from "./index.js";

declare const text: string;

const run = defineMachine({
  id: "run",
  states: ["queued", "running", "done"],
  initial: "queued",
  terminal: ["done"],
  transitions: {
    start: { from: ["queued"], to: "running" },
    finish: { from: ["running"], to: "done" },
  },
});

const valid = run.transition("queued", "start");
void valid;

const misspelledFrom = defineMachine({
  id: "m",
  states: ["a", "b"],
  initial: "a",
  terminal: ["b"],
  transitions: {
    // @ts-expect-error "aa" is not a member of states
    go: { from: ["aa"], to: "b" },
  },
});
void misspelledFrom;

const misspelledTo = defineMachine({
  id: "m",
  states: ["a", "b"],
  initial: "a",
  terminal: ["b"],
  transitions: {
    // @ts-expect-error "bb" is not a member of states
    go: { from: ["a"], to: "bb" },
  },
});
void misspelledTo;

const misspelledInitial = defineMachine({
  id: "m",
  states: ["a", "b"],
  // @ts-expect-error "aa" is not a member of states
  initial: "aa",
  terminal: ["b"],
  transitions: {
    go: { from: ["a"], to: "b" },
  },
});
void misspelledInitial;

const misspelledTerminal = defineMachine({
  id: "m",
  states: ["a", "b"],
  initial: "a",
  // @ts-expect-error "bb" is not a member of states
  terminal: ["bb"],
  transitions: {
    go: { from: ["a"], to: "b" },
  },
});
void misspelledTerminal;

const explicitMachine = defineMachine<"a" | "b", "go" | "back">({
  id: "m",
  states: ["a", "b"],
  initial: "a",
  terminal: [],
  transitions: {
    go: { from: ["a"], to: "b" },
    back: { from: ["b"], to: "a" },
  },
});
void explicitMachine;

const missingEvent = defineMachine<"a" | "b", "go" | "back">({
  id: "m",
  states: ["a", "b"],
  initial: "a",
  terminal: [],
  // @ts-expect-error the "back" event key is required when events are explicit
  transitions: {
    go: { from: ["a"], to: "b" },
  },
});
void missingEvent;

const extraEvent = defineMachine<"a" | "b", "go">({
  id: "m",
  states: ["a", "b"],
  initial: "a",
  terminal: [],
  transitions: {
    go: { from: ["a"], to: "b" },
    // @ts-expect-error "back" is not declared in the explicit event union
    back: { from: ["b"], to: "a" },
  },
});
void extraEvent;

// @ts-expect-error "quued" is not a state
void run.transition("quued", "start");

// @ts-expect-error "stat" is not an event
void run.transition("queued", "stat");

// @ts-expect-error a plain string is not an event
void run.transition("queued", text);

// @ts-expect-error a plain string is not a state
void run.can(text, "start");
