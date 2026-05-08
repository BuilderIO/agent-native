import { describe, expect, it } from "vitest";
import {
  builderCreditsFromCostCents,
  calculateCost,
  usageBillingForEngine,
} from "./store.js";

describe("usage billing", () => {
  it("maps Builder hard costs to agent credits with margin", () => {
    expect(builderCreditsFromCostCents(100)).toBe(25);
    expect(builderCreditsFromCostCents(1)).toBe(0.25);
  });

  it("rounds Builder credits up to the same precision as ai-services", () => {
    expect(builderCreditsFromCostCents(0.001)).toBe(0.001);
  });

  it("uses Builder credit display only for the Builder engine", () => {
    expect(usageBillingForEngine("builder").unit).toBe("builder-credits");
    expect(usageBillingForEngine("anthropic").unit).toBe("usd");
    expect(usageBillingForEngine(null).unit).toBe("usd");
  });

  it("does not round tiny completed calls down to zero spend", () => {
    expect(calculateCost(10, 2, "claude-sonnet-4-5")).toBe(1);
  });
});
