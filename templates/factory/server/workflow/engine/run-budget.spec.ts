import { describe, expect, it } from "vitest";

import { createRunBudget } from "./run-budget.js";

describe("createRunBudget", () => {
  it("hands out exactly its cap, then takes nothing more", () => {
    const budget = createRunBudget(2);

    expect([
      budget.takeModelCall(),
      budget.takeModelCall(),
      budget.takeModelCall(),
    ]).toEqual([true, true, false]);
    expect(budget.remainingModelCalls()).toBe(0);
    expect(budget.usedModelCalls()).toBe(2);
    expect(budget.cap).toBe(2);
  });

  it("starts full", () => {
    const budget = createRunBudget(50);
    expect(budget.remainingModelCalls()).toBe(50);
    expect(budget.usedModelCalls()).toBe(0);
  });

  it.each([-1, 1.5, Number.NaN])("refuses a cap of %s", (cap) => {
    expect(() => createRunBudget(cap)).toThrow(RangeError);
  });
});
