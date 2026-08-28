import { describe, expect, it } from "vitest";

import { canStartFactoryApproval } from "./inbox-approve";

describe("canStartFactoryApproval", () => {
  it("requires a decision", () => {
    expect(
      canStartFactoryApproval({
        hasDecision: false,
        itemStatus: "needs_manual",
        runs: [],
      }),
    ).toBe(false);
  });

  it("allows needs_manual and shadow_decided with no active run", () => {
    expect(
      canStartFactoryApproval({
        hasDecision: true,
        itemStatus: "needs_manual",
        runs: [],
      }),
    ).toBe(true);
    expect(
      canStartFactoryApproval({
        hasDecision: true,
        itemStatus: "shadow_decided",
        runs: [{ status: "failed" }],
      }),
    ).toBe(true);
  });

  it("blocks statuses that already started or finished", () => {
    for (const itemStatus of [
      "automation_started",
      "auto_approved",
      "merged",
      "classified",
    ]) {
      expect(
        canStartFactoryApproval({
          hasDecision: true,
          itemStatus,
          runs: [],
        }),
      ).toBe(false);
    }
  });

  it("blocks when a run is already in flight or completed", () => {
    expect(
      canStartFactoryApproval({
        hasDecision: true,
        itemStatus: "needs_manual",
        runs: [{ status: "running" }],
      }),
    ).toBe(false);
  });
});
