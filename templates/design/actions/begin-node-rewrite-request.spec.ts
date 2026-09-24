import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  readAppState: vi.fn(),
  compareAndSetAppState: vi.fn(),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (config: unknown) => config,
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: mocks.readAppState,
  compareAndSetAppState: mocks.compareAndSetAppState,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

import { designRepromptPendingStateKey } from "../shared/node-rewrite.js";
import action from "./begin-node-rewrite-request.js";

const request = {
  repromptId: "reprompt_2",
  designId: "design_1",
  fileId: "file_1",
  target: { nodeId: "hero" },
  baseVersionHash: "hash_base",
  instruction: "Make it darker",
  createdAt: "2026-07-17T00:00:00.000Z",
};

describe("begin-node-rewrite-request", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readAppState.mockResolvedValue(null);
    mocks.compareAndSetAppState.mockResolvedValue(true);
  });

  it("atomically creates the first pending request", async () => {
    await expect(action.run(request)).resolves.toEqual({
      started: true,
      repromptId: "reprompt_2",
    });
    expect(mocks.compareAndSetAppState).toHaveBeenCalledWith(
      designRepromptPendingStateKey("design_1", "file_1"),
      null,
      expect.objectContaining({ status: "pending", repromptId: "reprompt_2" }),
    );
  });

  it("refuses to replace an acceptance reservation", async () => {
    mocks.readAppState.mockResolvedValue({
      ...request,
      repromptId: "reprompt_1",
      status: "resolving",
      claimId: "claim_1",
      proposalId: "proposal_1",
      resolution: "accept",
    });

    await expect(action.run(request)).rejects.toThrow(
      "currently being accepted",
    );
    expect(mocks.compareAndSetAppState).not.toHaveBeenCalled();
  });

  it("requires a refinement to replace the proposal it was based on", async () => {
    mocks.readAppState.mockResolvedValue({
      ...request,
      repromptId: "reprompt_3",
      status: "pending",
    });

    await expect(
      action.run({
        ...request,
        priorProposalId: "proposal_1",
        priorRepromptId: "reprompt_1",
      }),
    ).rejects.toThrow("candidates changed before refinement");
  });

  it("fails when another request wins the same compare-and-set", async () => {
    mocks.compareAndSetAppState.mockResolvedValue(false);

    await expect(action.run(request)).rejects.toThrow("changed concurrently");
  });
});
