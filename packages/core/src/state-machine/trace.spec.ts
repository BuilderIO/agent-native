import { describe, expect, it } from "vitest";

import { defineMachine } from "./index.js";
import { renderMachineTrace } from "./trace.js";

const sampleMachine = defineMachine({
  id: "sample",
  states: ["ready", "done"],
  initial: "ready",
  terminal: ["done"],
  transitions: {
    finish: { from: ["ready"], to: "done" },
  },
});

describe("renderMachineTrace", () => {
  it("renders accepted and rejected steps with their SQL guards", () => {
    expect(renderMachineTrace(sampleMachine, ["finish", "finish"]))
      .toMatchInlineSnapshot(`
        "finish -> done [guard: 'ready']
        finish -> done (rejected) [guard: 'ready']"
      `);
  });
});
