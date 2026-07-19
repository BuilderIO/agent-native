import { beforeEach, describe, expect, it, vi } from "vitest";

const { trackEvent } = vi.hoisted(() => ({ trackEvent: vi.fn() }));

vi.mock("@agent-native/core/client/analytics", () => ({ trackEvent }));

import {
  multiFrontierFailureCategory,
  trackMultiFrontierLifecycle,
} from "./multi-frontier-telemetry.js";

describe("multi-frontier lifecycle telemetry", () => {
  beforeEach(() => trackEvent.mockClear());

  it("projects only bounded categorical lifecycle fields", () => {
    trackMultiFrontierLifecycle({
      kind: "phase",
      phase: "checkpoint_review",
      round: 2,
      approvalState: "pending",
      autoContinueAfterAgreement: false,
      checkpointCount: 2,
      reviewCount: 3,
      requiresPlanningPrompt: false,
    });

    expect(trackEvent).toHaveBeenCalledWith("multi_frontier_lifecycle", {
      kind: "phase",
      phase: "checkpoint_review",
      round: 2,
      approval_state: "pending",
      auto_continue_after_agreement: false,
      checkpoint_count: 2,
      review_count: 3,
      requires_planning_prompt: false,
    });
    const serialized = JSON.stringify(trackEvent.mock.calls);
    expect(serialized).not.toMatch(
      /collaboration|diff|balance|email|organization|account/i,
    );
  });

  it("classifies failures without forwarding their messages", () => {
    expect(
      multiFrontierFailureCategory("A participant reached its usage limit."),
    ).toBe("quota");
    expect(
      multiFrontierFailureCategory("Refresh the subscription connection."),
    ).toBe("auth");
    expect(multiFrontierFailureCategory("The process exited.")).toBe(
      "provider",
    );
    expect(multiFrontierFailureCategory(undefined)).toBe("unknown");
  });
});
