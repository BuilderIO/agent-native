import type { RunBudget } from "../adapter.js";

export interface EngineBudget extends RunBudget {
  readonly cap: number;
  usedModelCalls(): number;
}

/** One per run. The runner draws from it before each model call, repairs included. */
export function createRunBudget(cap: number): EngineBudget {
  if (!Number.isInteger(cap) || cap < 0) {
    throw new RangeError(
      `A model-call cap is a whole number of zero or more; got ${cap}.`,
    );
  }
  let used = 0;
  return {
    cap,
    usedModelCalls: () => used,
    remainingModelCalls: () => cap - used,
    takeModelCall() {
      if (used >= cap) return false;
      used += 1;
      return true;
    },
  };
}
