import { describe, expect, it } from "vitest";

import { validateDecisionInput } from "./validation.js";

function decisionInput(value: unknown) {
  return {
    input: [{ type: "json", value }],
    questions: [
      {
        type: "choice",
        name: "route",
        instructions: "Choose a route.",
        choices: [
          { value: "billing", description: "Payment questions" },
          { value: "technical", description: "Product questions" },
        ],
      },
    ],
  };
}

describe("validateDecisionInput JSON values", () => {
  it.each([
    ["NaN", Number.NaN],
    ["infinity", Number.POSITIVE_INFINITY],
    ["undefined object properties", { nested: { missing: undefined } }],
    ["undefined array entries", ["present", undefined]],
    ["bigints", { value: BigInt(1) }],
    ["functions", { value: () => "value" }],
    ["symbols", { value: Symbol("value") }],
  ])("rejects %s", (_label, value) => {
    expect(validateDecisionInput(decisionInput(value))).toBe(false);
  });

  it("rejects cycles but accepts a repeated acyclic reference", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(validateDecisionInput(decisionInput(cyclic))).toBe(false);

    const shared = { nested: ["value", 2] };
    expect(
      validateDecisionInput(decisionInput({ first: shared, second: shared })),
    ).toBe(true);
  });

  it("rejects sparse arrays and arrays with extra properties", () => {
    const sparse = new Array(2);
    sparse[1] = "present";
    expect(validateDecisionInput(decisionInput(sparse))).toBe(false);

    const extra = ["value"] as unknown[] & { label?: string };
    extra.label = "ignored by JSON.stringify";
    expect(validateDecisionInput(decisionInput(extra))).toBe(false);

    const customArray = ["value"];
    Object.setPrototypeOf(customArray, {});
    expect(validateDecisionInput(decisionInput(customArray))).toBe(false);
  });

  it("rejects non-plain prototypes, accessors, hidden properties, and symbols", () => {
    expect(validateDecisionInput(decisionInput(new Date()))).toBe(false);
    expect(
      validateDecisionInput(
        decisionInput(
          Object.assign(Object.create({ inherited: true }), { value: 1 }),
        ),
      ),
    ).toBe(false);

    let getterCalled = false;
    const accessor: Record<string, unknown> = {};
    Object.defineProperty(accessor, "value", {
      enumerable: true,
      get() {
        getterCalled = true;
        return "hidden side effect";
      },
    });
    expect(validateDecisionInput(decisionInput(accessor))).toBe(false);
    expect(getterCalled).toBe(false);

    const hidden = { value: 1 };
    Object.defineProperty(hidden, "secret", { value: 2 });
    expect(validateDecisionInput(decisionInput(hidden))).toBe(false);

    expect(
      validateDecisionInput(decisionInput({ [Symbol("hidden")]: "value" })),
    ).toBe(false);

    const uninspectable = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error("unreadable object");
        },
      },
    );
    expect(validateDecisionInput(decisionInput(uninspectable))).toBe(false);
  });

  it("accepts valid nested JSON", () => {
    expect(
      validateDecisionInput(
        decisionInput({
          nullish: null,
          text: "value",
          enabled: true,
          count: 3,
          nested: [{ safe: "value" }],
        }),
      ),
    ).toBe(true);
  });
});
